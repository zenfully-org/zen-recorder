/**
 * Pulls raw PCM off the mixer for the WebCodecs encoder. Firefox has no MediaStreamTrackProcessor
 * and Meet's CSP forbids Workers on the page, but an AudioWorklet module from a blob URL is allowed:
 * it runs on the audio thread and posts 2048-frame buffers to the main thread through a
 * MessagePort. The graph is source → tap → gain(0) → destination (a tap only runs when it reaches
 * the destination; the zero gain keeps it inaudible). Where the page's CSP refuses a blob module
 * (Teams'), the module comes from the extension's own file: Firefox checks no page's CSP for a
 * `moz-extension:` URL (`SubjectToCSP` in Gecko's dom/security/nsCSPService.cpp exempts every
 * scheme flagged `URI_IS_LOCAL_RESOURCE`). Without either, a ScriptProcessorNode records.
 *
 * Neither path drops a buffer, but a busy page takes them late: Gecko hands a MessagePort's
 * messages to the main thread one per task (`MessagePort::Dispatch` queues the next one behind every
 * task queued meanwhile), so a Stop or a Pause handled meanwhile overtakes the backlog, and a
 * ScriptProcessor holds the audio of its partly filled buffer until it fills. `capture()` therefore
 * starts or stops passing buffers at the call's place in the audio, not at the moment the page gets
 * to it. One buffer per task would also let a page whose tasks take longer than a buffer (43 ms)
 * fall behind for as long as its load lasts, so the page answers each message it takes, and once a
 * few messages are unanswered the worklet keeps its buffers: the next answer brings everything it
 * captured meanwhile in one message.
 *
 * Every buffer carries the graph frame of its first sample, on the context's clock, so the
 * encoder places it where it was captured, not where the page got it. The worklet reads
 * `currentFrame`, which Gecko advances with every render quantum; the ScriptProcessor's first
 * `playbackTime` is the graph time at its buffer's end, and its buffers follow each other.
 */
import { audioTapWorklet } from '@/lib/page/audio-tap-worklet';
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
  /** The URL of the worklet's file in the extension, null while it is not known. */
  moduleFile?: () => string | null;
  /**
   * Loads a module into the worklet: `AudioWorklet.prototype.addModule` as it was before any
   * script of the page ran, so a page that replaced it never sees the URLs. Default: the
   * worklet's own.
   */
  addModule?: (worklet: AudioWorklet, url: string) => Promise<void>;
  /** ScriptProcessor fallback buffer size (power of two, 256–16384). */
  bufferSize?: number;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface AudioTap {
  /** Which capture path ended up in use ('pending' until the worklet module has loaded). */
  kind(): 'pending' | 'worklet' | 'processor';
  /** Where the worklet's module came from: a blob URL or the extension's file; null without one. */
  module(): 'blob' | 'file' | null;
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
  | { kind: 'worklet'; node: AudioWorkletNode; module: 'blob' | 'file' }
  | { kind: 'processor'; node: ScriptProcessorNode };

/**
 * A pending `capture()` takes effect this long after the last buffer at the latest. Not a cap: a
 * backlog that is still arriving keeps it waiting. Longer than a 16384-frame ScriptProcessor
 * buffer (341 ms at 48 kHz).
 */
const CHANGE_IDLE_MS = 1000;

const WORKLET = audioTapWorklet();

/** Loads the worklet's module from a blob URL, else from the extension's file. */
async function loadModule(
  worklet: AudioWorklet,
  deps: AudioTapDeps,
): Promise<'blob' | 'file' | null> {
  const addModule = deps.addModule ?? ((target, url) => target.addModule(url));
  const load = (url: string) =>
    addModule(worklet, url).then(
      () => true,
      () => false,
    );
  if (deps.createObjectURL) {
    const url = deps.createObjectURL(new Blob([WORKLET.source], { type: 'text/javascript' }));
    const loaded = await load(url);
    deps.revokeObjectURL?.(url);
    if (loaded) return 'blob';
  }
  const file = deps.moduleFile?.() ?? null;
  return file !== null && (await load(file)) ? 'file' : null;
}

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
    if (!Ctor || !worklet) return false;
    const module = await loadModule(worklet, deps);
    if (module === null) return false;
    if (disposed) return true;
    const tap = new Ctor(context, WORKLET.processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    tap.port.onmessage = (event: MessageEvent) => {
      const message = parseTapMessage(event.data);
      if (message?.type === 'drained') applyChanges(message.id);
      if (message?.type !== 'samples') return;
      // Whole: what the worklet kept while the page was busy goes to the encoder in one sample, so
      // it waits for the encoder's queue once (Mediabunny waits for a `dequeue`, a task, per sample).
      emit(message.data, message.frame);
      armIdleTimer();
      // Taken: the worklet may post again, what it kept meanwhile in one message.
      tap.port.postMessage({ more: true });
    };
    source.connect(tap);
    tap.connect(gain);
    path = { kind: 'worklet', node: tap, module };
    return true;
  };

  const ready = attachWorklet().then((attached) => {
    if (!attached && !disposed) attachProcessor();
  });

  return {
    kind: () => path?.kind ?? 'pending',
    module: () => (path?.kind === 'worklet' ? path.module : null),
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
