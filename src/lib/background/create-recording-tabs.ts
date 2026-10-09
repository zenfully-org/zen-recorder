/**
 * Remembers which meeting tab each recording comes from, so what the background tells about a
 * recording (its file saved, its save failed, little storage left) reaches that tab and no other.
 *
 * A tab names its recording in its snapshot only while it records: by the time the file of a
 * recording it stopped is saved, it is idle like every other meeting tab. So the tab is known from
 * what it sent about the recording: its start, its chunks and its end. A recording no connected
 * tab sent anything about, such as one saved as recovered after its tab closed, has no tab.
 */
import type { TabToBackground } from '@/lib/types';

export interface RecordingTabs<T> {
  /** Tab `tabId` sent `message`: the recording it is about comes from that tab. */
  claim(tabId: number, message: TabToBackground): void;
  /** The connection of the tab recording `recordingId` comes from, while that tab is connected. */
  tabOf(recordingId: string): T | undefined;
}

/** How many recordings are remembered: the ones heard of last. */
const REMEMBERED = 100;

const recordingOf = (message: TabToBackground): string | null => {
  if (message.type === 'chunk') return message.chunk.recordingId;
  if (message.type === 'recordingStarted' || message.type === 'recordingEnded') {
    return message.info.recordingId;
  }
  return null;
};

export function createRecordingTabs<T>(
  connected: (tabId: number) => T | undefined,
): RecordingTabs<T> {
  /** Oldest first: a recording heard of again moves to the end, so a long one is not forgotten. */
  let heard: { recordingId: string; tabId: number }[] = [];

  return {
    claim(tabId, message) {
      const recordingId = recordingOf(message);
      if (recordingId === null) return;
      const others = heard.filter((entry) => entry.recordingId !== recordingId);
      heard = [...others, { recordingId, tabId }].slice(-REMEMBERED);
    },
    tabOf(recordingId) {
      const entry = heard.find((candidate) => candidate.recordingId === recordingId);
      return entry ? connected(entry.tabId) : undefined;
    },
  };
}
