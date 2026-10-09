/**
 * Encoder abstraction over MediaRecorder (Opus in WebM). A WebCodecs + Mediabunny encoder can
 * later implement the same interface for seekable, streaming output.
 */
import { createAudioFileClock } from '@/lib/page/create-audio-file-clock';
import { pickMimeType } from '@/lib/page/pick-mime-type';

export interface EncodedChunk {
  seq: number;
  blob: Blob;
  timestampMs: number;
}

export interface EncoderOptions {
  audioBitsPerSecond: number;
  timesliceMs: number;
}

export interface Encoder {
  mimeType(): string;
  state(): RecordingState;
  start(stream: MediaStream, options: EncoderOptions): void;
  pause(): void;
  resume(): void;
  /** Resolves after the final chunk has been emitted through `onChunk`. */
  stop(): Promise<void>;
  /** Forces a chunk boundary now (used before pagehide so as little as possible is lost). */
  flush(): void;
  /**
   * Where the recording is in its file now, in milliseconds: what a player shows at this moment of
   * the meeting. Paused spans are not in the file, so it stands still while paused; it never goes
   * back, is 0 before `start()` and stays where it was when `stop()` was called. Chunk timestamps
   * are wall time and cannot say this.
   */
  mediaTimeMs(): number;
}

export interface MediaRecorderEncoderDeps {
  MediaRecorder: typeof MediaRecorder;
  now: () => number;
  /** The clock of the audio graph the recorder is fed from, in seconds (the mixer's context). */
  audioClock: () => number;
  onChunk: (chunk: EncodedChunk) => void;
  onError: (error: Error) => void;
}

export function createMediaRecorderEncoder(deps: MediaRecorderEncoderDeps): Encoder {
  const preferred = pickMimeType((t) => deps.MediaRecorder.isTypeSupported(t));
  let recorder: MediaRecorder | null = null;
  let seq = 0;
  let startedAt = 0;
  let stopped: Promise<void> | null = null;
  const clock = createAudioFileClock(deps.audioClock);

  return {
    mimeType: () => recorder?.mimeType || preferred,
    state: () => recorder?.state ?? 'inactive',
    start(stream, options) {
      if (recorder) throw new Error('encoder already started');
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: options.audioBitsPerSecond,
      };
      if (preferred) recorderOptions.mimeType = preferred;
      const instance = new deps.MediaRecorder(stream, recorderOptions);
      recorder = instance;
      seq = 0;
      startedAt = deps.now();
      instance.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0) return;
        deps.onChunk({
          seq: seq++,
          blob: event.data,
          timestampMs: Math.round(deps.now() - startedAt),
        });
      });
      instance.addEventListener('error', (event) => {
        const error: unknown = 'error' in event ? event.error : undefined;
        deps.onError(
          error instanceof Error ? error : new Error(String(error ?? 'MediaRecorder error')),
        );
      });
      instance.start(options.timesliceMs);
      clock.start();
    },
    pause() {
      if (recorder?.state !== 'recording') return;
      recorder.pause();
      clock.pause();
    },
    resume() {
      if (recorder?.state !== 'paused') return;
      recorder.resume();
      clock.resume();
    },
    stop() {
      const instance = recorder;
      if (!instance) return Promise.resolve();
      clock.stop();
      stopped ??= new Promise<void>((resolve) => {
        instance.addEventListener('stop', () => resolve(), { once: true });
        if (instance.state === 'inactive') resolve();
        else instance.stop();
      });
      return stopped;
    },
    flush() {
      if (recorder?.state === 'recording') recorder.requestData();
    },
    mediaTimeMs: () => clock.mediaTimeMs(),
  };
}
