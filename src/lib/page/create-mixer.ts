/**
 * Web Audio mixer: every remote audio track plus the microphone clone is summed into a single
 * MediaStream the recorder consumes. Nothing is connected to `ctx.destination`; the page already
 * plays the remote audio and a second path would echo. A silent constant source stays connected
 * so the stream carries samples even while no track is: Firefox gives a tap zero channels from a
 * destination without inputs, which would stall the recording's audio clock.
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
   * Seconds of audio the stream has carried since the context was made: the context's time, plus
   * the wall time of every span it was not running. A suspended context's clock stands still, but
   * Firefox's MediaRecorder goes on writing the stream's file with silence (verified in Firefox 155:
   * 2 s suspended in 8 s of recording gave an 8.01 s file and 6.0 s of context time).
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
  /** Create a muted <audio> sink per track (keeps Chromium-family engines pumping the track). */
  elementSinks?: boolean;
  AudioContext?: typeof AudioContext;
  /** The wall clock in milliseconds; the page's `performance.now()` by default. */
  now?: () => number;
}

interface SourceEntry {
  node: MediaStreamAudioSourceNode;
  sink: HTMLAudioElement | null;
}

export function createMixer(doc: Document, options: MixerOptions = {}): Mixer {
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
  const sources = new Map<string, SourceEntry>();
  const elementSinks = options.elementSinks ?? true;
  const now = options.now ?? (() => performance.now());
  /** Wall milliseconds the context was not running, and since when it is not, if it is not now. */
  let stoppedMs = 0;
  let stoppedSince: number | null = context.state === 'running' ? null : now();
  const stoppedNow = (): number => (stoppedSince === null ? 0 : now() - stoppedSince);
  context.addEventListener('statechange', () => {
    stoppedMs += stoppedNow();
    stoppedSince = context.state === 'running' ? null : now();
  });

  const resume = (): void => {
    if (context.state === 'suspended') context.resume().catch(() => undefined);
  };

  const detach = (entry: SourceEntry): void => {
    entry.node.disconnect();
    if (entry.sink) {
      entry.sink.pause();
      entry.sink.srcObject = null;
    }
  };

  const removeTrack = (track: MediaStreamTrack): void => {
    const entry = sources.get(track.id);
    if (!entry) return;
    detach(entry);
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
      const stream = new MediaStream([track]);
      const node = context.createMediaStreamSource(stream);
      node.connect(destination);
      let sink: HTMLAudioElement | null = null;
      if (elementSinks) {
        try {
          sink = doc.createElement('audio');
          sink.muted = true;
          sink.srcObject = stream;
          sink.play().catch(() => undefined);
        } catch {
          // The sink is only Chromium insurance; recording must not depend on it.
          sink = null;
        }
      }
      sources.set(track.id, { node, sink });
      track.addEventListener('ended', () => removeTrack(track), { once: true });
      resume();
    },
    removeTrack,
    resume,
    async close() {
      for (const entry of sources.values()) detach(entry);
      sources.clear();
      keepAlive.disconnect();
      if (context.state !== 'closed') await context.close();
    },
  };
}
