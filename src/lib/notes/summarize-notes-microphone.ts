import { countTimes } from '@/lib/notes/count-times';
import { formatMediaOffset } from '@/lib/notes/format-media-offset';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';

type MicState = 'live' | 'muted' | 'not-connected';

/** The time of the file spent in `state`, and how many times it began. */
const spansOf = (
  changes: readonly { state: MicState | null; fromMs: number }[],
  endMs: number,
  state: MicState,
): { count: number; totalMs: number } =>
  changes.reduce(
    (sum, change, index) => {
      if (change.state !== state) return sum;
      const toMs = changes[index + 1]?.fromMs ?? endMs;
      return { count: sum.count + 1, totalMs: sum.totalMs + Math.max(0, toMs - change.fromMs) };
    },
    { count: 0, totalMs: 0 },
  );

/**
 * The user's microphone over the file, in one line: "muted once, 0:01:30 in total", rather than a
 * row per toggle. From the state at the start and every `mic` event after it.
 */
export function summarizeNotesMicrophone(document: MeetingNotesDocument): string {
  if (document.capture.signals.mic === 'not-available') return 'not observed';
  const started = document.events.find((event) => event.type === 'recording-started');
  const startState = started?.mic ?? null;
  const toggles = document.events.flatMap((event) =>
    event.type === 'mic' ? [{ state: event.state, fromMs: event.mediaMs }] : [],
  );
  if (startState === null && toggles.length === 0) return 'not observed';
  const changes = [{ state: startState, fromMs: 0 }, ...toggles];
  // Without the file's length, the last event's position is where the file is known to reach.
  const endMs =
    document.recording.durationMs ?? Math.max(...document.events.map((event) => event.mediaMs));
  const muted = spansOf(changes, endMs, 'muted');
  const absent = spansOf(changes, endMs, 'not-connected');
  const parts = [
    ...(muted.count === 0
      ? []
      : [`muted ${countTimes(muted.count)}, ${formatMediaOffset(muted.totalMs)} in total`]),
    ...(absent.count === 0
      ? []
      : [
          `not connected ${countTimes(absent.count)}, ${formatMediaOffset(absent.totalMs)} in total`,
        ]),
  ];
  return parts.length === 0 ? 'on for the whole recording' : parts.join('; ');
}
