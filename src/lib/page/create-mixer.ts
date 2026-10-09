/**
 * Web Audio mixer: every remote audio track plus the microphone clone is summed into a single
 * MediaStream the recorder consumes. Nothing is connected to `ctx.destination`; the page already
 * plays the remote audio and a second path would echo. A silent constant source stays connected
 * so the stream carries samples even while no track is: Firefox gives a tap zero channels from a
 * destination without inputs, which would stall the recording's audio clock.
 *
 * A track reaches the mixer through the audio graph alone: no media element plays it. In Firefox a
 * `MediaStreamAudioSourceNode` takes its input from the track's own graph track
 * (`MediaStreamAudioSourceNode::AttachToTrack` adds a consumer port), and the graph pulls a remote
 * WebRTC track's audio while its transceiver receives (`MediaPipelineReceiveAudio`, enabled by the
 * receiving state), whether or not an element plays it. Other engines need an element to pump a
 * remote track; this extension is for Firefox only.
 */

/**
 * The mixer's context: 48 kHz, the rate of Opus and of WebRTC audio. Firefox runs one audio graph
 * per window, sample rate and output device, so a context opened to warm the mixer's graph up
 * must be made with these.
 */
export const MIXER_CONTEXT_OPTIONS = {
  sampleRate: 48_000,
  latencyHint: 'playback',
} as const satisfies AudioContextOptions;

export interface Mixer {
  readonly context: AudioContext;
  readonly stream: MediaStream;
  /**
   * Seconds of audio the stream has carried since the context first ran: the context's time, plus
   * the wall time of every span it was not running after that. A suspended context's clock stands
   * still, but Firefox's MediaRecorder goes on writing the stream's file with silence (verified in
   * Firefox 155: 2 s suspended in 8 s of recording gave an 8.01 s file and 6.0 s of context time).
   * Before its first run, while its graph opens the audio device, the stream carries nothing: a
   * file recorded from it starts once the context runs.
   */
  streamTime(): number;
  trackCount(): number;
  hasTrack(track: MediaStreamTrack): boolean;
  addTrack(track: MediaStreamTrack): void;
  removeTrack(track: MediaStreamTrack): void;
  resume(): void;
  close(): Promise<void>;
}

export interface MixerOptions {
  sampleRate?: number;
  AudioContext?: typeof AudioContext;
  /** The wall clock in milliseconds; the page's `performance.now()` by default. */
  now?: () => number;
}

/** Where the mixer finds its `AudioContext`: the document's window. */
export interface MixerDocument {
  defaultView: { AudioContext: typeof AudioContext } | null;
}

export function createMixer(doc: MixerDocument, options: MixerOptions = {}): Mixer {
  const Ctor = options.AudioContext ?? doc.defaultView?.AudioContext ?? AudioContext;
  const context = new Ctor({
    ...MIXER_CONTEXT_OPTIONS,
    sampleRate: options.sampleRate ?? MIXER_CONTEXT_OPTIONS.sampleRate,
  });
  const destination = context.createMediaStreamDestination();
  const keepAlive = context.createConstantSource();
  keepAlive.offset.value = 0;
  keepAlive.connect(destination);
  keepAlive.start();
  const sources = new Map<string, MediaStreamAudioSourceNode>();
  const now = options.now ?? (() => performance.now());
  /**
   * Wall milliseconds the context was not running after it first ran, and since when it is not, if
   * it is not now. Before its first run nothing counts.
   */
  let stoppedMs = 0;
  let stoppedSince: number | null = null;
  let hasRun = context.state === 'running';
  const stoppedNow = (): number => (stoppedSince === null ? 0 : now() - stoppedSince);
  context.addEventListener('statechange', () => {
    stoppedMs += stoppedNow();
    hasRun ||= context.state === 'running';
    stoppedSince = hasRun && context.state !== 'running' ? now() : null;
  });

  const resume = (): void => {
    if (context.state === 'suspended') context.resume().catch(() => undefined);
  };

  const removeTrack = (track: MediaStreamTrack): void => {
    const node = sources.get(track.id);
    if (!node) return;
    node.disconnect();
    sources.delete(track.id);
  };

  return {
    context,
    stream: destination.stream,
    streamTime: () => context.currentTime + (stoppedMs + stoppedNow()) / 1000,
    trackCount: () => sources.size,
    hasTrack: (track) => sources.has(track.id),
    addTrack(track) {
      if (track.kind !== 'audio' || sources.has(track.id)) return;
      const node = context.createMediaStreamSource(new MediaStream([track]));
      node.connect(destination);
      sources.set(track.id, node);
      track.addEventListener('ended', () => removeTrack(track), { once: true });
      resume();
    },
    removeTrack,
    resume,
    async close() {
      for (const node of sources.values()) node.disconnect();
      sources.clear();
      keepAlive.disconnect();
      if (context.state !== 'closed') await context.close();
    },
  };
}
