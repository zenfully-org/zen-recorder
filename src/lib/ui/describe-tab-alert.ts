/**
 * What the person recording reads when a meeting tab cannot record as it should, a fault that
 * lasts and that the snapshot says: the page holds as much as it may of what could not be saved
 * yet (`backlogFull`), or the recorder gave up on a broken encoder (`encoderGaveUp`). A few words,
 * the whole of it, and the toast that tells it once. The status card and the popup say it in the
 * same words.
 */
import type { BacklogFull, TabSnapshot } from '@/lib/types';

/** Which fault a tab shows, from the least to the most pressing. */
export type TabAlertKind = BacklogFull | 'encoder-gave-up';

export interface TabAlert {
  kind: TabAlertKind;
  /** True when nothing records while it lasts: the tab says "Not recording", not its state. */
  nothingRecords: boolean;
  label: string;
  detail: string;
  toast: string;
}

const ALERTS: Record<TabAlertKind, Omit<TabAlert, 'kind'>> = {
  'audio-only': {
    nothingRecords: false,
    label: 'Audio only',
    detail:
      'The video stopped: this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only. Keep this tab open until it is saved.',
    toast:
      'Zen Recorder: the video stopped, because this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only; keep this tab open until it is saved.',
  },
  waiting: {
    nothingRecords: true,
    label: 'Waiting for space',
    detail:
      'Nothing records: this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
    toast:
      'Zen Recorder: nothing records now, because this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
  },
  'encoder-gave-up': {
    nothingRecords: true,
    label: 'Recording failed',
    detail:
      'Nothing records: the recording failed several times in a row, and the recorder stopped trying so as not to leave a trail of broken files. The Diagnostics log says why. Press Record to try again.',
    toast:
      'Zen Recorder: the recording failed several times in a row, so nothing records now. Press Record to try again.',
  },
};

export function describeTabAlert(
  snapshot: Pick<TabSnapshot, 'backlogFull' | 'encoderGaveUp'>,
): TabAlert | null {
  // The person can act on it now: Record tries again. A full backlog waits for the disk.
  const kind = snapshot.encoderGaveUp ? 'encoder-gave-up' : snapshot.backlogFull;
  return kind ? { kind, ...ALERTS[kind] } : null;
}
