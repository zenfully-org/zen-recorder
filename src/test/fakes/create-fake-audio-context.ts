/**
 * AudioContext double with every member of `AudioContext`, so the code under test takes it, its
 * nodes and its constructor as the real ones. The parts the mixer and the audio tap use behave:
 * stream sources and destinations, gains, constant sources, script processors and worklet nodes
 * running the processor their module registered. Every other member throws, naming itself. Classes
 * are used only where the real API is one (the context, `AudioWorkletNode`).
 */

/** What a node feeds, in the order it was connected; empty once disconnected. */
interface Connections {
  connected: (AudioNode | AudioParam)[];
}

export type FakeAudioNode = MediaStreamAudioSourceNode & Connections;

export interface FakeScriptProcessor extends ScriptProcessorNode, Connections {
  /**
   * The graph renders one buffer of mono samples (the context's clock moves past it) and hands
   * it to `onaudioprocess`. Its `playbackTime` is the graph time at the buffer's end, as Gecko
   * gives the first buffer; later ones add `delaySeconds`, the main thread's lag so far.
   */
  emitAudio(samples: Float32Array<ArrayBuffer>): void;
  /** Added to the `playbackTime` of every buffer after the first (Gecko's `DelaySoFar`). */
  delaySeconds: number;
  /** While true, rendered buffers wait in `queued`: a main thread too busy to take them. */
  holdEvents: boolean;
  queued: AudioProcessingEvent[];
  /** The main thread handles the queued buffers in order, all of them or the first `count`. */
  deliver(count?: number): void;
}

export interface FakeGainNode extends GainNode, Connections {}

export interface FakeConstantSource extends ConstantSourceNode, Connections {
  started: boolean;
}

interface FakeStreamDestination extends MediaStreamAudioDestinationNode, Connections {}

/**
 * An `AudioWorkletNode` running the processor its module registered, with Gecko's threading: the
 * processor sees port messages at the start of the next render (on a microtask while the context
 * runs: the audio thread is never busy), and what it posts reaches `port.onmessage` in order.
 */
export interface FakeAudioWorkletNode extends AudioWorkletNode, Connections {
  name: string;
  options: AudioWorkletNodeOptions | undefined;
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

export interface FakeAudioContext extends AudioContext {
  /** The graph renders `seconds` that no tap captures (it runs before the tap attaches). */
  advanceGraph(seconds: number): void;
  sources: FakeAudioNode[];
  processors: FakeScriptProcessor[];
  gains: FakeGainNode[];
  workletNodes: FakeAudioWorkletNode[];
  constantSources: FakeConstantSource[];
  /** The node `createMediaStreamDestination()` returns. */
  readonly streamDestination: FakeStreamDestination;
  /** Its stream. */
  readonly destinationStream: MediaStream;
  /**
   * The modules `addModule` was asked for, in order. Absent when the context was created without
   * `worklet`, as Firefox has none outside a secure context (which the type does not say).
   */
  readonly audioWorklet: AudioWorklet & { modules: string[] };
  /** Constructor to inject as `AudioWorkletNode` (records instances in `workletNodes`). */
  readonly AudioWorkletNode: typeof AudioWorkletNode;
  /** `URL.createObjectURL` for worklet modules: `addModule` runs the blob's source. */
  createObjectURL(blob: Blob): string;
  /** A module file at `url` (an extension's file), which `addModule` runs like a blob's. */
  serveModule(url: string, source: string): void;
  resumeCalls: number;
  /** Simulate the browser suspending the context (autoplay policy). */
  suspendByPolicy(): void;
  /**
   * An `AudioContext` constructor whose every `new` hands out this context, as a page's would
   * make one; `constructedWith` lists the options each call passed.
   */
  readonly Constructor: typeof AudioContext;
  readonly constructedWith: unknown[];
}

interface FakeAudioContextOptions {
  initialState?: AudioContextState;
  failResume?: boolean;
  /**
   * Expose `audioWorklet`; `'fail'` makes `addModule` reject every module, `'refuse-blob'` only
   * a blob one, as Firefox does on a page whose policy does not allow `blob:` scripts.
   */
  worklet?: boolean | 'fail' | 'refuse-blob';
}

/** The processor side of a worklet node's port, as `AudioWorkletProcessor.port` gives it. */
interface ProcessorPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): unknown;
}

/** One context's audio graph: its clock and state, and what its worklet registered. */
interface Graph {
  readonly options: FakeAudioContextOptions;
  readonly sampleRate: number;
  state: AudioContextState;
  /** Frames the graph has rendered: the context's clock. */
  rendered: number;
  /** Where the context's own events go. */
  readonly events: EventTarget;
  readonly registered: Map<string, unknown>;
  /** The port `AudioWorkletProcessor` hands to the processor being constructed. */
  constructingPort: ProcessorPort | null;
  readonly workletNodes: FakeAudioWorkletNode[];
}

const RENDER_QUANTUM = 128;

/** Each fake context's graph, which its worklet nodes find through the context they are given. */
const graphs = new WeakMap<BaseAudioContext, Graph>();

/** What a member the recorder never uses does in the double. */
function notFaked(member: string): never {
  throw new Error(`the fake AudioContext has no ${member}`);
}

function isProcessor(value: unknown): value is Processor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'process' in value &&
    typeof value.process === 'function'
  );
}

/** Moves the graph to `next` and says so with 'statechange', as Firefox does: on a change only. */
function enterState(graph: Graph, next: AudioContextState): void {
  if (graph.state === next) return;
  graph.state = next;
  graph.events.dispatchEvent(new Event('statechange'));
}

/** Listener methods that hand everything to `events`. */
function delegateEvents(events: EventTarget) {
  return {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => events.addEventListener(type, listener, options),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => events.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  };
}

/** An automatable parameter at `value`; nothing schedules it. */
function createAudioParam(value: number): AudioParam {
  return {
    automationRate: 'a-rate',
    defaultValue: value,
    maxValue: Number.MAX_VALUE,
    minValue: -Number.MAX_VALUE,
    value,
    cancelAndHoldAtTime: () => notFaked('AudioParam.cancelAndHoldAtTime'),
    cancelScheduledValues: () => notFaked('AudioParam.cancelScheduledValues'),
    exponentialRampToValueAtTime: () => notFaked('AudioParam.exponentialRampToValueAtTime'),
    linearRampToValueAtTime: () => notFaked('AudioParam.linearRampToValueAtTime'),
    setTargetAtTime: () => notFaked('AudioParam.setTargetAtTime'),
    setValueAtTime: () => notFaked('AudioParam.setValueAtTime'),
    setValueCurveAtTime: () => notFaked('AudioParam.setValueCurveAtTime'),
  };
}

/** The context's listener, where nothing is spatialized. */
function createAudioListener(): AudioListener {
  return {
    forwardX: createAudioParam(0),
    forwardY: createAudioParam(0),
    forwardZ: createAudioParam(-1),
    positionX: createAudioParam(0),
    positionY: createAudioParam(0),
    positionZ: createAudioParam(0),
    upX: createAudioParam(0),
    upY: createAudioParam(1),
    upZ: createAudioParam(0),
    setOrientation: () => notFaked('AudioListener.setOrientation'),
    setPosition: () => notFaked('AudioListener.setPosition'),
  };
}

/** A mono buffer holding `samples`. */
function createAudioBuffer(samples: Float32Array<ArrayBuffer>, sampleRate: number): AudioBuffer {
  return {
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    copyFromChannel: () => notFaked('AudioBuffer.copyFromChannel'),
    copyToChannel: () => notFaked('AudioBuffer.copyToChannel'),
    getChannelData: () => samples,
  };
}

/** Records `target` as fed by `node`; returns what `connect` returns. */
function connectNode(node: AudioNode & Connections, target: AudioNode | AudioParam): AudioNode {
  node.connected.push(target);
  return 'connect' in target ? target : node;
}

/** A node of `context` with the members every audio node has, plus `own`. */
function createAudioNode<T extends object>(
  context: BaseAudioContext,
  own: T,
): AudioNode & Connections & T {
  const node: AudioNode & Connections = {
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    context,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    connected: [],
    connect: (target: AudioNode | AudioParam) => connectNode(node, target),
    disconnect: () => {
      node.connected = [];
    },
    ...delegateEvents(new EventTarget()),
  };
  return Object.assign(node, own);
}

/** A script processor of `context` that hands over the buffers the test renders. */
function createScriptProcessor(
  context: BaseAudioContext,
  graph: Graph,
  bufferSize: number,
): FakeScriptProcessor {
  let emitted = 0;
  const node: FakeScriptProcessor = createAudioNode<
    Omit<FakeScriptProcessor, keyof AudioNode | keyof Connections>
  >(context, {
    bufferSize,
    onaudioprocess: null,
    delaySeconds: 0,
    holdEvents: false,
    queued: [],
    emitAudio: (samples) => {
      graph.rendered += samples.length;
      const delay = emitted++ === 0 ? 0 : node.delaySeconds;
      node.queued.push(
        Object.assign(new Event('audioprocess'), {
          inputBuffer: createAudioBuffer(samples, graph.sampleRate),
          outputBuffer: createAudioBuffer(new Float32Array(samples.length), graph.sampleRate),
          playbackTime: graph.rendered / graph.sampleRate + delay,
        }),
      );
      if (!node.holdEvents) node.deliver();
    },
    deliver: (count = node.queued.length) => {
      for (const event of node.queued.splice(0, count)) node.onaudioprocess?.(event);
    },
  });
  return node;
}

/**
 * Where a fake worklet finds its modules: blobs the page made URLs for, and files served at a URL
 * of their own (an extension's). A page whose policy refuses `blob:` scripts gets Firefox's error.
 */
function createModuleSources() {
  const blobs = new Map<string, Blob>();
  const files = new Map<string, string>();
  return {
    createObjectURL(blob: Blob): string {
      const url = `blob:fake-module-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    },
    serveModule(url: string, source: string): void {
      files.set(url, source);
    },
    async read(url: string, refuseBlob: boolean): Promise<string | undefined> {
      if (refuseBlob && url.startsWith('blob:')) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return files.get(url) ?? (await blobs.get(url)?.text());
    },
  };
}

/** The context's worklet: `addModule` runs a module's source, which registers its processors. */
function createWorklet(
  graph: Graph,
  sources: ReturnType<typeof createModuleSources>,
): AudioWorklet & { modules: string[] } {
  const { worklet } = graph.options;
  // What a processor module sees as globals besides the two it is handed.
  const scope = {
    get currentFrame() {
      return graph.rendered;
    },
  };
  function FakeAudioWorkletProcessor(this: { port: ProcessorPort | null }) {
    this.port = graph.constructingPort;
  }
  const modules: string[] = [];
  return {
    modules,
    async addModule(url) {
      const href = String(url);
      modules.push(href);
      if (worklet === 'fail') throw new Error('module rejected');
      const source = await sources.read(href, worklet === 'refuse-blob');
      if (source === undefined) throw new Error(`no module at ${href}`);
      const run = new Function(
        'registerProcessor',
        'AudioWorkletProcessor',
        'scope',
        `with (scope) {\n${source}\n}`,
      );
      run(
        (name: string, processor: unknown) => {
          graph.registered.set(name, processor);
        },
        FakeAudioWorkletProcessor,
        scope,
      );
    },
  };
}

/** Constructs `name`'s processor with `port` as its own, as `AudioWorkletProcessor` hands it over. */
function constructProcessor(graph: Graph, name: string, port: ProcessorPort): Processor {
  const Processor = graph.registered.get(name);
  if (typeof Processor !== 'function') throw new Error(`no processor named ${name}`);
  graph.constructingPort = port;
  const processor: unknown = Reflect.construct(Processor, []);
  graph.constructingPort = null;
  if (!isProcessor(processor)) throw new Error(`${name} has no process()`);
  return processor;
}

class FakeAudioWorkletNodeClass extends EventTarget implements FakeAudioWorkletNode {
  channelCount = 1;
  channelCountMode: ChannelCountMode = 'explicit';
  channelInterpretation: ChannelInterpretation = 'speakers';
  readonly context: BaseAudioContext;
  readonly numberOfInputs = 1;
  readonly numberOfOutputs = 1;
  connected: (AudioNode | AudioParam)[] = [];
  onprocessorerror = null;
  readonly parameters: AudioParamMap = new Map<string, AudioParam>();
  readonly port: MessagePort;
  name: string;
  options: AudioWorkletNodeOptions | undefined;
  holdMessages = false;
  queued: unknown[] = [];
  render: (samples: Float32Array) => void;
  renderWithoutInput: (frames: number) => void;

  constructor(context: BaseAudioContext, name: string, nodeOptions?: AudioWorkletNodeOptions) {
    super();
    const graph = graphs.get(context);
    if (!graph) throw new Error('a fake worklet node needs a fake AudioContext');
    this.context = context;
    this.name = name;
    this.options = nodeOptions;
    const inbox: unknown[] = [];
    const processorPort: ProcessorPort = {
      onmessage: null,
      postMessage: (message) => {
        this.queued.push(message);
        if (!this.holdMessages) this.deliver();
      },
    };
    const processor = constructProcessor(graph, name, processorPort);
    const runInbox = () => {
      for (const data of inbox.splice(0)) processorPort.onmessage?.({ data });
    };
    this.port = {
      onmessage: null,
      onmessageerror: null,
      postMessage: (message: unknown) => {
        inbox.push(message);
        if (graph.state === 'running') queueMicrotask(runInbox);
      },
      start: () => undefined,
      close: () => undefined,
      ...delegateEvents(new EventTarget()),
    };
    // The graph renders whole quanta: frames short of one wait for the next render.
    let carried = new Float32Array(0);
    this.render = (samples) => {
      runInbox();
      const input = new Float32Array(carried.length + samples.length);
      input.set(carried);
      input.set(samples, carried.length);
      const whole = input.length - (input.length % RENDER_QUANTUM);
      for (let at = 0; at < whole; at += RENDER_QUANTUM) {
        const quantum = input.slice(at, at + RENDER_QUANTUM);
        processor.process([[quantum]], [[new Float32Array(RENDER_QUANTUM)]]);
        graph.rendered += RENDER_QUANTUM;
      }
      carried = input.slice(whole);
    };
    this.renderWithoutInput = (frames) => {
      runInbox();
      for (let at = 0; at < frames; at += RENDER_QUANTUM) {
        processor.process([[]], [[new Float32Array(RENDER_QUANTUM)]]);
        graph.rendered += RENDER_QUANTUM;
      }
    };
    graph.workletNodes.push(this);
  }

  connect(target: AudioNode | AudioParam): AudioNode {
    return connectNode(this, target);
  }

  disconnect(): void {
    this.connected = [];
  }

  deliver(count = this.queued.length): void {
    for (const data of this.queued.splice(0, count)) {
      this.port.onmessage?.(new MessageEvent('message', { data }));
    }
  }
}

class FakeAudioContextClass extends EventTarget implements FakeAudioContext {
  readonly #graph: Graph;
  readonly #sources = createModuleSources();
  // AudioContext
  readonly baseLatency = 0;
  readonly outputLatency = 0;
  // BaseAudioContext
  readonly audioWorklet: AudioWorklet & { modules: string[] };
  readonly destination: AudioDestinationNode = createAudioNode(this, { maxChannelCount: 2 });
  readonly listener = createAudioListener();
  onstatechange = null;
  readonly sampleRate = 48_000;
  // The double's own
  sources: FakeAudioNode[] = [];
  processors: FakeScriptProcessor[] = [];
  gains: FakeGainNode[] = [];
  workletNodes: FakeAudioWorkletNode[] = [];
  constantSources: FakeConstantSource[] = [];
  readonly destinationStream = new MediaStream();
  readonly streamDestination: FakeStreamDestination = createAudioNode(this, {
    stream: this.destinationStream,
  });
  readonly AudioWorkletNode: typeof AudioWorkletNode = FakeAudioWorkletNodeClass;
  readonly createObjectURL = this.#sources.createObjectURL;
  readonly serveModule = this.#sources.serveModule;
  resumeCalls = 0;
  readonly constructedWith: unknown[] = [];
  readonly Constructor: typeof AudioContext;

  constructor(_contextOptions?: AudioContextOptions, options: FakeAudioContextOptions = {}) {
    super();
    this.#graph = {
      options,
      sampleRate: this.sampleRate,
      state: options.initialState ?? 'running',
      rendered: 0,
      events: new EventTarget(),
      registered: new Map(),
      constructingPort: null,
      workletNodes: this.workletNodes,
    };
    graphs.set(this, this.#graph);
    this.audioWorklet = createWorklet(this.#graph, this.#sources);
    this.Constructor = new Proxy(FakeAudioContextClass, {
      construct: (_target, args) => {
        this.constructedWith.push(args[0]);
        return this;
      },
    });
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    listenerOptions?: boolean | AddEventListenerOptions,
  ): void {
    this.#graph.events.addEventListener(type, listener, listenerOptions);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    listenerOptions?: boolean | EventListenerOptions,
  ): void {
    this.#graph.events.removeEventListener(type, listener, listenerOptions);
  }

  override dispatchEvent(event: Event): boolean {
    return this.#graph.events.dispatchEvent(event);
  }

  get currentTime(): number {
    return this.#graph.rendered / this.sampleRate;
  }

  get state(): AudioContextState {
    return this.#graph.state;
  }

  advanceGraph(seconds: number): void {
    this.#graph.rendered += Math.round(seconds * this.sampleRate);
  }

  suspendByPolicy(): void {
    enterState(this.#graph, 'suspended');
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    if (this.#graph.options.failResume) throw new Error('autoplay blocked');
    enterState(this.#graph, 'running');
  }

  async close(): Promise<void> {
    this.#graph.state = 'closed';
  }

  createMediaStreamSource(mediaStream: MediaStream): MediaStreamAudioSourceNode {
    const node: FakeAudioNode = createAudioNode(this, { mediaStream });
    this.sources.push(node);
    return node;
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    return this.streamDestination;
  }

  createConstantSource(): ConstantSourceNode {
    const node: FakeConstantSource = createAudioNode(this, {
      offset: createAudioParam(1),
      started: false,
      onended: null,
      start: () => {
        node.started = true;
      },
      stop: () => notFaked('ConstantSourceNode.stop'),
    });
    this.constantSources.push(node);
    return node;
  }

  createGain(): GainNode {
    const node: FakeGainNode = createAudioNode(this, { gain: createAudioParam(1) });
    this.gains.push(node);
    return node;
  }

  createScriptProcessor(bufferSize = 4096): ScriptProcessorNode {
    const node = createScriptProcessor(this, this.#graph, bufferSize);
    this.processors.push(node);
    return node;
  }

  createMediaElementSource(): MediaElementAudioSourceNode {
    return notFaked('createMediaElementSource');
  }

  getOutputTimestamp(): AudioTimestamp {
    return notFaked('getOutputTimestamp');
  }

  suspend(): Promise<void> {
    return notFaked('suspend');
  }

  createAnalyser(): AnalyserNode {
    return notFaked('createAnalyser');
  }

  createBiquadFilter(): BiquadFilterNode {
    return notFaked('createBiquadFilter');
  }

  createBuffer(): AudioBuffer {
    return notFaked('createBuffer');
  }

  createBufferSource(): AudioBufferSourceNode {
    return notFaked('createBufferSource');
  }

  createChannelMerger(): ChannelMergerNode {
    return notFaked('createChannelMerger');
  }

  createChannelSplitter(): ChannelSplitterNode {
    return notFaked('createChannelSplitter');
  }

  createConvolver(): ConvolverNode {
    return notFaked('createConvolver');
  }

  createDelay(): DelayNode {
    return notFaked('createDelay');
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return notFaked('createDynamicsCompressor');
  }

  createIIRFilter(): IIRFilterNode {
    return notFaked('createIIRFilter');
  }

  createOscillator(): OscillatorNode {
    return notFaked('createOscillator');
  }

  createPanner(): PannerNode {
    return notFaked('createPanner');
  }

  createPeriodicWave(): PeriodicWave {
    return notFaked('createPeriodicWave');
  }

  createStereoPanner(): StereoPannerNode {
    return notFaked('createStereoPanner');
  }

  createWaveShaper(): WaveShaperNode {
    return notFaked('createWaveShaper');
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return notFaked('decodeAudioData');
  }
}

export function createFakeAudioContext(options: FakeAudioContextOptions = {}): FakeAudioContext {
  const ctx = new FakeAudioContextClass(undefined, options);
  // Firefox gives a context no `audioWorklet` outside a secure context.
  if (!options.worklet) Reflect.deleteProperty(ctx, 'audioWorklet');
  return ctx;
}
