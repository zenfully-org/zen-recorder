/**
 * Whether a recording with video has sound. Its audio comes from the recorder's own audio graph,
 * which the browser runs only once it can open an audio output (none with no output device or a
 * sound server that is stuck, nor before the page allows audio): meanwhile the video records alone,
 * and nothing else tells the person recording that the file will have no sound. Read once per
 * tick: past the wait without audio, Diagnostics say so once per recording and the snapshot says
 * `noAudio` until the audio starts, which the status card, the popup and the toolbar show.
 */
import type { Encoder } from '@/lib/page/create-media-recorder-encoder';
import type { TabSnapshot } from '@/lib/types';

/**
 * How far into the file the audio may not have started yet. A page's first audio graph runs
 * 0.7-1.8 s after it is made on a slow machine, and the first audio of a recording came at most
 * 2.0 s in over 863 recordings on CI's runners; 5 s leaves that room and still tells the person
 * within the first seconds of the meeting.
 */
export const AUDIO_START_WAIT_MS = 5_000;

/** What the watch reads of the recording that runs. */
interface Watched {
  id: string;
  encoder: Pick<Encoder, 'mediaTimeMs'>;
  /** The video pipeline, whose audio tap says whether the audio started; null without video. */
  video: { audioStarted(): boolean } | null;
}

export function createAudioStartWatch(deps: { log: (level: 'warn', message: string) => void }) {
  /** The recording whose audio has not started by the wait. */
  let missing: string | null = null;
  return {
    /** Reads the recording that runs (null for none); once per tick. */
    check(recording: Watched | null): void {
      // Without video the audio is all the file holds, and the browser's recorder records it.
      if (!recording?.video || recording.video.audioStarted()) {
        missing = null;
        return;
      }
      if (missing === recording.id || recording.encoder.mediaTimeMs() < AUDIO_START_WAIT_MS) return;
      missing = recording.id;
      deps.log(
        'warn',
        `the audio has not started ${AUDIO_START_WAIT_MS / 1000} s into the recording: the browser runs no audio in this tab (no audio output it can open, or its autoplay policy), so the file has no sound until it does`,
      );
    },
    /** What the snapshot says of the recording `activeId`. */
    snapshot(activeId: string | null): Pick<TabSnapshot, 'noAudio'> {
      return missing !== null && missing === activeId ? { noAudio: true } : {};
    },
  };
}
