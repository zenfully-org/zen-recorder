/** AudioContext double covering the nodes the mixer and the audio tap use. */

export interface FakeAudioNode {
  connected: unknown[];
  connect(target: unknown): void;
  disconnect(): void;
}

export interface FakeScriptProcessor extends FakeAudioNode {
  bufferSize: number;
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
  /**
   * The graph renders one buffer of mono samples (the context's clock moves past it) and hands
   * it to `onaudioprocess`. Its `playbackTime` is the graph time at the buffer's end, as Gecko
   * gives the first buffer; later ones add `delaySeconds`, the main thread's lag so far.
   */
  emitAudio(samples: Float32Array): void;
  /** Added to the `playbackTime` of every buffer after the first (Gecko's `DelaySoFar`). */
  delaySeconds: number;
  /** While true, rendered buffers wait in `queued`: a main thread too busy to take them. */
  holdEvents: boolean;
  queued: AudioProcessingEvent[];
  /** The main thread handles the queued buffers in order, all of them or the first `count`. */
  deliver(count?: number): void;
}

export interface FakeGainNode extends FakeAudioNode {
  gain: { value: number };
}

export interface FakeConstantSource extends FakeAudioNode {
  offset: { value: number };
  started: boolean;
  start(): void;
}

/**
 * An `AudioWorkletNode` running the processor its module registered, with Gecko's threading: the
 * processor sees port messages at the start of the next render (on a microtask while the context
 * runs: the audio thread is never busy), and what it posts reaches `port.onmessage` in order.
 */
export interface FakeAudioWorkletNode extends FakeAudioNode {
  name: string;
  options: unknown;
  port: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
  };
  /**
   * While true, what the processor posts waits in `queued`: a main thread too busy to take it.
   * Gecko's MessagePort keeps such messages and hands them over one per task, later.
   */
  holdMessages: boolean;
  /** Messages the processor posted that the main thread has not handled yet. */
  queued: unknown[];
  /**
   * The audio thread renders `samples` through the processor, 128 frames per quantum; the
   * context's clock moves with every quantum and the processor's scope sees it as `currentFrame`.
   */
  render(samples: Float32Array): void;
  /** The audio thread renders `frames` with nothing connected: quanta without input channels. */
  renderWithoutInput(frames: number): void;
  /**
   * The main thread handles the queued messages in order, all of them or the first `count`
   * (dropped when nobody listens).
   */
  deliver(count?: number): void;
}

export interface FakeAudioContext extends EventTarget {
  state: AudioContextState;
  sampleRate: number;
  /** Seconds the graph has rendered (what `context.currentTime` tells the main thread). */
  readonly currentTime: number;
  /** The graph renders `seconds` that no tap captures (it runs before the tap attaches). */
  advanceGraph(seconds: number): void;
  options: unknown;
  sources: FakeAudioNode[];
  processors: FakeScriptProcessor[];
  gains: FakeGainNode[];
  workletNodes: FakeAudioWorkletNode[];
  constantSources: FakeConstantSource[];
  /** The node `createMediaStreamDestination()` returns. */
  streamDestination: { stream: MediaStream };
  /** Present when the context was created with `worklet: true`. */
  audioWorklet?: { addModule(url: string): Promise<void>; modules: string[] };
  /** Constructor to inject as `AudioWorkletNode` (records instances in `workletNodes`). */
  AudioWorkletNode: typeof AudioWorkletNode;
  /** `URL.createObjectURL` for worklet modules: `addModule` runs the blob's source. */
  createObjectURL(blob: Blob): string;
  destination: { kind: 'destination' };
  destinationStream: MediaStream;
  resumeCalls: number;
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(stream: MediaStream): FakeAudioNode;
  createMediaStreamDestination(): { stream: MediaStream };
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): FakeScriptProcessor;
  createGain(): FakeGainNode;
  createConstantSource(): FakeConstantSource;
  /** Simulate the browser suspending the context (autoplay policy). */
  suspendByPolicy(): void;
}

/** The processor side of a worklet node's port, as `AudioWorkletProcessor.port` gives it. */
interface ProcessorPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): unknown;
}

const RENDER_QUANTUM = 128;

function isProcessor(value: unknown): value is Processor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'process' in value &&
    typeof value.process === 'function'
  );
}

/** Moves the context to `state` and says so with 'statechange', as Firefox does: on a change only. */
function enterState(ctx: FakeAudioContext, state: AudioContextState): void {
  if (ctx.state === state) return;
  ctx.state = state;
  ctx.dispatchEvent(new Event('statechange'));
}

export function createFakeAudioContext(
  options: {
    initialState?: AudioContextState;
    failResume?: boolean;
    /** Expose `audioWorklet`; `'fail'` makes `addModule` reject. */
    worklet?: boolean | 'fail';
  } = {},
): FakeAudioContext {
  const ctx = new EventTarget() as FakeAudioContext;
  ctx.state = options.initialState ?? 'running';
  ctx.sampleRate = 48_000;
  /** Frames the graph has rendered: the context's clock. */
  let rendered = 0;
  Object.defineProperty(ctx, 'currentTime', {
    get: () => rendered / ctx.sampleRate,
    configurable: true,
  });
  ctx.advanceGraph = (seconds) => {
    rendered += Math.round(seconds * ctx.sampleRate);
  };
  // What a processor module sees as globals besides the two it is handed.
  const scope = {
    get currentFrame() {
      return rendered;
    },
  };
  ctx.sources = [];
  ctx.processors = [];
  ctx.gains = [];
  ctx.workletNodes = [];
  const blobs = new Map<string, Blob>();
  ctx.createObjectURL = (blob) => {
    const url = `blob:fake-module-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  const registered = new Map<string, unknown>();
  // The port `AudioWorkletProcessor` hands to the processor being constructed.
  let constructingPort: ProcessorPort | null = null;
  function FakeAudioWorkletProcessor(this: { port: ProcessorPort | null }) {
    this.port = constructingPort;
  }
  if (options.worklet) {
    const modules: string[] = [];
    ctx.audioWorklet = {
      modules,
      async addModule(url) {
        modules.push(url);
        if (options.worklet === 'fail') throw new Error('module rejected');
        const source = await blobs.get(url)?.text();
        if (source === undefined) throw new Error(`no module at ${url}`);
        const run = new Function(
          'registerProcessor',
          'AudioWorkletProcessor',
          'scope',
          `with (scope) {\n${source}\n}`,
        );
        run(
          (name: string, processor: unknown) => {
            registered.set(name, processor);
          },
          FakeAudioWorkletProcessor,
          scope,
        );
      },
    };
  }
  ctx.AudioWorkletNode = function FakeAudioWorkletNode(
    this: FakeAudioWorkletNode,
    _context: unknown,
    name: string,
    nodeOptions: unknown,
  ) {
    const Processor = registered.get(name);
    if (typeof Processor !== 'function') throw new Error(`no processor named ${name}`);
    const node = this;
    const inbox: unknown[] = [];
    const processorPort: ProcessorPort = {
      onmessage: null,
      postMessage(message) {
        node.queued.push(message);
        if (!node.holdMessages) node.deliver();
      },
    };
    constructingPort = processorPort;
    const processor: unknown = Reflect.construct(Processor, []);
    constructingPort = null;
    if (!isProcessor(processor)) throw new Error(`${name} has no process()`);
    const runInbox = () => {
      for (const data of inbox.splice(0)) processorPort.onmessage?.({ data });
    };
    node.name = name;
    node.options = nodeOptions;
    node.connected = [];
    node.holdMessages = false;
    node.queued = [];
    node.port = {
      onmessage: null,
      postMessage(message) {
        inbox.push(message);
        if (ctx.state === 'running') queueMicrotask(runInbox);
      },
    };
    node.connect = (target) => {
      node.connected.push(target);
    };
    node.disconnect = () => {
      node.connected = [];
    };
    // The graph renders whole quanta: frames short of one wait for the next render.
    let carried = new Float32Array(0);
    node.render = (samples) => {
      runInbox();
      const input = new Float32Array(carried.length + samples.length);
      input.set(carried);
      input.set(samples, carried.length);
      const whole = input.length - (input.length % RENDER_QUANTUM);
      for (let at = 0; at < whole; at += RENDER_QUANTUM) {
        const quantum = input.slice(at, at + RENDER_QUANTUM);
        processor.process([[quantum]], [[new Float32Array(RENDER_QUANTUM)]]);
        rendered += RENDER_QUANTUM;
      }
      carried = input.slice(whole);
    };
    node.renderWithoutInput = (frames) => {
      runInbox();
      for (let at = 0; at < frames; at += RENDER_QUANTUM) {
        processor.process([[]], [[new Float32Array(RENDER_QUANTUM)]]);
        rendered += RENDER_QUANTUM;
      }
    };
    node.deliver = (count = node.queued.length) => {
      for (const data of node.queued.splice(0, count)) {
        node.port.onmessage?.(new MessageEvent('message', { data }));
      }
    };
    ctx.workletNodes.push(node);
  } as unknown as typeof AudioWorkletNode;
  ctx.destination = { kind: 'destination' };
  ctx.destinationStream = new MediaStream();
  ctx.resumeCalls = 0;
  ctx.resume = async () => {
    ctx.resumeCalls++;
    if (options.failResume) throw new Error('autoplay blocked');
    enterState(ctx, 'running');
  };
  ctx.close = async () => {
    ctx.state = 'closed';
  };
  ctx.createMediaStreamSource = () => {
    const node: FakeAudioNode = {
      connected: [],
      connect(target) {
        node.connected.push(target);
      },
      disconnect() {
        node.connected = [];
      },
    };
    ctx.sources.push(node);
    return node;
  };
  ctx.constantSources = [];
  ctx.streamDestination = { stream: ctx.destinationStream };
  ctx.createMediaStreamDestination = () => ctx.streamDestination;
  ctx.createConstantSource = () => {
    const node: FakeConstantSource = {
      offset: { value: 1 },
      started: false,
      connected: [],
      connect(target) {
        node.connected.push(target);
      },
      disconnect() {
        node.connected = [];
      },
      start() {
        node.started = true;
      },
    };
    ctx.constantSources.push(node);
    return node;
  };
  ctx.createScriptProcessor = (bufferSize) => {
    let emitted = 0;
    const node: FakeScriptProcessor = {
      bufferSize,
      onaudioprocess: null,
      connected: [],
      connect(target) {
        node.connected.push(target);
      },
      disconnect() {
        node.connected = [];
      },
      delaySeconds: 0,
      holdEvents: false,
      queued: [],
      emitAudio(samples) {
        rendered += samples.length;
        const delay = emitted++ === 0 ? 0 : node.delaySeconds;
        const event = {
          inputBuffer: { getChannelData: () => samples, sampleRate: ctx.sampleRate },
          playbackTime: rendered / ctx.sampleRate + delay,
        } as unknown as AudioProcessingEvent;
        node.queued.push(event);
        if (!node.holdEvents) node.deliver();
      },
      deliver(count = node.queued.length) {
        for (const event of node.queued.splice(0, count)) node.onaudioprocess?.(event);
      },
    };
    ctx.processors.push(node);
    return node;
  };
  ctx.createGain = () => {
    const node: FakeGainNode = {
      gain: { value: 1 },
      connected: [],
      connect(target) {
        node.connected.push(target);
      },
      disconnect() {
        node.connected = [];
      },
    };
    ctx.gains.push(node);
    return node;
  };
  ctx.suspendByPolicy = () => enterState(ctx, 'suspended');
  return ctx;
}
