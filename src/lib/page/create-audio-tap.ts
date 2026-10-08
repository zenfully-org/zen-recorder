/**
 * Pulls raw PCM off the mixer for the WebCodecs encoder. Firefox has no MediaStreamTrackProcessor
 * and Meet's CSP forbids Workers on the page, but an AudioWorklet module from a blob URL is allowed:
 * it runs on the audio thread and posts 2048-frame buffers to the main thread through a
 * MessagePort. The graph is source → tap → gain(0) → destination (a tap only runs when it reaches
 * the destination; the zero gain keeps it inaudible). Falls back to a ScriptProcessorNode where the
 * page's CSP refuses the blob module.
 *
 * Neither path drops a buffer, but a busy page takes them late: Gecko hands a MessagePort's
 * messages to the main thread one per task, so a Stop or a Pause handled meanwhile overtakes the
 * backlog, and a ScriptProcessor holds the audio of its partly filled buffer until it fills.
 * `capture()` therefore starts or stops passing buffers at the call's place in the audio, not at
 * the moment the page gets to it.
 *
 * Every buffer carries the graph frame of its first sample, on the context's clock, so the
 * encoder places it where it was captured, not where the page got it. The worklet reads
 * `currentFrame`, which Gecko advances with every render quantum; the ScriptProcessor's first
 * `playbackTime` is the graph time at its buffer's end, and its buffers follow each other.
 */
import { parseTapMessage } from '@/lib/protocol/parse-tap-message';

export interface AudioSamples {
  /** Mono f32 samples (a private copy). */
  data: Float32Array;
  sampleRate: number;
  /** The graph frame of the first sample: `AudioContext.currentTime` × `sampleRate` then. */
  frame: number;
}

export interface AudioTapDeps {
  context: AudioContext;
  stream: MediaStream;
  onSamples: (samples: AudioSamples) => void;
  /** `globalThis.AudioWorkletNode`; absent → ScriptProcessor fallback. */
  AudioWorkletNode?: typeof AudioWorkletNode | undefined;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  /** ScriptProcessor fallback buffer size (power of two, 256–16384). */
  bufferSize?: number;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface AudioTap {
  /** Which capture path ended up in use ('pending' until the worklet module has loaded). */
  kind(): 'pending' | 'worklet' | 'processor';
  bufferSize: number;
  /** Resolves once the capture path is attached. */
  ready: Promise<void>;
  /** The audio graph's clock as the page reads it (`AudioContext.currentTime`), in seconds. */
  graphTime(): number;
  /**
   * Starts (`true`) or stops passing buffers to `onSamples` at the call's place in the audio:
   * every buffer captured before the call is treated as before, however late the page gets it,
   * and every later one follows `on`. The worklet marks the place by posting its partly filled
   * buffer and an answer behind everything it posted before; on the ScriptProcessor path the next
   * buffer holds the moment of the call. Resolves once in effect, at the latest `CHANGE_IDLE_MS`
   * after the last buffer (a graph that does not run). Changes take effect in call order; at once
   * while nothing is attached. A new tap passes buffers.
   */
  capture(on: boolean): Promise<void>;
  dispose(): void;
}

type CapturePath =
  | { kind: 'worklet'; node: AudioWorkletNode }
  | { kind: 'processor'; node: ScriptProcessorNode };

const PROCESSOR_NAME = 'zen-recorder-tap';
/** Frames per posted buffer (16 render quanta ≈ 43 ms at 48 kHz). */
const WORKLET_BUFFER_FRAMES = 2048;
/**
 * A pending `capture()` takes effect this long after the last buffer at the latest. Not a cap: a
 * backlog that is still arriving keeps it waiting. Longer than a 16384-frame ScriptProcessor
 * buffer (341 ms at 48 kHz).
 */
const CHANGE_IDLE_MS = 1000;

// The AudioWorklet API requires a processor class; it lives in this string, not in our module.
// It posts `{ frame, samples }`: `frame` is `currentFrame` at the buffer's first sample. A quantum
// without input channels is silence, so the tap's frames keep up with the graph's. A message
// `{ flush: id }` makes it post its partly filled buffer, then `{ flushed: id }`.
const WORKLET_SOURCE = `
registerProcessor('${PROCESSOR_NAME}', (function () {
  return class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = new Float32Array(${WORKLET_BUFFER_FRAMES});
      this.filled = 0;
      this.start = 0;
      this.port.onmessage = (event) => {
        this.post();
        this.port.postMessage({ flushed: event.data.flush });
      };
    }
    post() {
      if (this.filled === 0) return;
      const out = this.buffer.slice(0, this.filled);
      this.port.postMessage({ frame: this.start, samples: out }, [out.buffer]);
      this.filled = 0;
    }
    process(inputs, outputs) {
      const frames = outputs[0][0].length;
      if (this.filled === 0) this.start = currentFrame;
      const channel = inputs[0] && inputs[0][0];
      if (channel) this.buffer.set(channel, this.filled);
      else this.buffer.fill(0, this.filled, this.filled + frames);
      this.filled += frames;
      if (this.filled >= ${WORKLET_BUFFER_FRAMES}) this.post();
      return true;
    }
  };
})());
`;

export function createAudioTap(deps: AudioTapDeps): AudioTap {
  const { context } = deps;
  const bufferSize = deps.bufferSize ?? 16384;
  const source = context.createMediaStreamSource(deps.stream);
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  let path: CapturePath | null = null;
  let disposed = false;
  let passing = true;
  /** `capture()` calls waiting for their place in the audio, oldest first. */
  let changes: { id: number; on: boolean; resolve: () => void }[] = [];
  let nextChangeId = 1;
  let idleTimer: number | undefined;

  const emit = (data: Float32Array, frame: number): void => {
    if (passing && !disposed) deps.onSamples({ data, sampleRate: context.sampleRate, frame });
  };

  /** (Re)starts the wait for the next buffer while a change is pending. */
  const armIdleTimer = (): void => {
    if (idleTimer !== undefined) deps.clearTimeout(idleTimer);
    idleTimer =
      changes.length > 0
        ? deps.setTimeout(() => applyChanges(Number.POSITIVE_INFINITY), CHANGE_IDLE_MS)
        : undefined;
  };

  /** Puts the changes up to `id` into effect, oldest first. */
  const applyChanges = (id: number): void => {
    const due = changes.filter((change) => change.id <= id);
    changes = changes.filter((change) => change.id > id);
    for (const change of due) {
      passing = change.on;
      change.resolve();
    }
    armIdleTimer();
  };

  const attachProcessor = (): void => {
    const processor = context.createScriptProcessor(bufferSize, 1, 1);
    /** Where the next buffer starts: only the first `playbackTime` is free of the page's lag. */
    let nextFrame: number | null = null;
    processor.onaudioprocess = (event) => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      const frame = nextFrame ?? Math.round(event.playbackTime * context.sampleRate) - data.length;
      nextFrame = frame + data.length;
      emit(data, frame);
      applyChanges(Number.POSITIVE_INFINITY);
    };
    source.connect(processor);
    processor.connect(gain);
    path = { kind: 'processor', node: processor };
  };

  const attachWorklet = async (): Promise<boolean> => {
    const Ctor = deps.AudioWorkletNode;
    const worklet = context.audioWorklet;
    const createObjectURL = deps.createObjectURL;
    if (!Ctor || !worklet || !createObjectURL) return false;
    const url = createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await worklet.addModule(url);
    } catch {
      return false;
    } finally {
      deps.revokeObjectURL?.(url);
    }
    if (disposed) return true;
    const tap = new Ctor(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    tap.port.onmessage = (event: MessageEvent) => {
      const message = parseTapMessage(event.data);
      if (message?.type === 'samples') {
        emit(message.data, message.frame);
        armIdleTimer();
      } else if (message) {
        applyChanges(message.id);
      }
    };
    source.connect(tap);
    tap.connect(gain);
    path = { kind: 'worklet', node: tap };
    return true;
  };

  const ready = attachWorklet().then((attached) => {
    if (!attached && !disposed) attachProcessor();
  });

  return {
    kind: () => path?.kind ?? 'pending',
    bufferSize,
    ready,
    graphTime: () => context.currentTime,
    capture(on) {
      const current = path;
      if (!current || disposed) {
        passing = on;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const id = nextChangeId++;
        changes.push({ id, on, resolve });
        if (current.kind === 'worklet') current.node.port.postMessage({ flush: id });
        armIdleTimer();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (path?.kind === 'processor') path.node.onaudioprocess = null;
      if (path?.kind === 'worklet') path.node.port.onmessage = null;
      path?.node.disconnect();
      source.disconnect();
      gain.disconnect();
      applyChanges(Number.POSITIVE_INFINITY);
    },
  };
}
