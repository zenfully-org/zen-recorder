/**
 * What the person recording reads when a meeting tab cannot record as it should, a fault that
 * lasts and that the snapshot says: the page holds as much as it may of what could not be saved
 * yet (`backlogFull`), the recorder gave up on a broken encoder (`encoderGaveUp`), or the call's
 * address names no meeting the recorder knows (`unknownAddress`). A few words, the whole of it,
 * the toast that tells it once, and the toolbar button's title. The status card, the popup and the
 * toolbar say it in the same words.
 */
import type { BacklogFull, TabSnapshot } from '@/lib/types';

/** Which fault a tab shows, from the least to the most pressing. */
export type TabAlertKind = BacklogFull | 'encoder-gave-up' | 'unknown-address';

export interface TabAlert {
  kind: TabAlertKind;
  /**
   * How pressing it is: 1 the video stopped, 2 nothing records until the extension takes what the
   * page holds, 3 nothing records until the person presses Record, 4 nothing records in this call
   * at all. Where only one fault can show, the more pressing one does.
   */
  severity: number;
  /** True when nothing records while it lasts: the tab says "Not recording", not its state. */
  nothingRecords: boolean;
  label: string;
  detail: string;
  toast: string;
  /** The toolbar button's title. The button is the browser's, not the tab's: it names no tab. */
  toolbar: string;
}

const ALERTS: Record<TabAlertKind, Omit<TabAlert, 'kind'>> = {
  'audio-only': {
    severity: 1,
    nothingRecords: false,
    label: 'Audio only',
    detail:
      'The video stopped: this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only. Keep this tab open until it is saved.',
    toast:
      'Zen Recorder: the video stopped, because this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only; keep this tab open until it is saved.',
    toolbar:
      'Zen Recorder: audio only. The video stopped: a meeting tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only. Keep that tab open until it is saved.',
  },
  waiting: {
    severity: 2,
    nothingRecords: true,
    label: 'Waiting for space',
    detail:
      'Nothing records: this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
    toast:
      'Zen Recorder: nothing records now, because this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
    toolbar:
      'Zen Recorder: waiting for space. Nothing records: a meeting tab holds as much as it can of recordings that could not be saved yet. Keep that tab open until they are.',
  },
  'encoder-gave-up': {
    severity: 3,
    nothingRecords: true,
    label: 'Recording failed',
    detail:
      'Nothing records: the recording failed several times in a row, and the recorder stopped trying so as not to leave a trail of broken files. The Diagnostics log says why. Press Record to try again.',
    toast:
      'Zen Recorder: the recording failed several times in a row, so nothing records now. Press Record to try again.',
    toolbar:
      'Zen Recorder: recording failed. Nothing records: the recording failed several times in a row in a meeting tab, and the recorder stopped trying. Press Record there to try again.',
  },
  'unknown-address': {
    severity: 4,
    nothingRecords: true,
    label: 'Unknown address',
    detail:
      "Nothing records: this call's address is new to Zen Recorder, so it cannot tell which meeting this is. Check for an update, or report it with the Diagnostics log.",
    toast:
      'Zen Recorder: nothing records in this call, because its address is new to Zen Recorder. Check for an update.',
    toolbar:
      'Zen Recorder: unknown address. Nothing records: a meeting tab is in a call whose address is new to Zen Recorder. Check for an update.',
  },
};

/** The fault the tab shows: the one that leaves the person the least to do. */
function kindOf(
  snapshot: Pick<TabSnapshot, 'backlogFull' | 'encoderGaveUp' | 'unknownAddress'>,
): TabAlertKind | undefined {
  // Nothing records in this call whatever the person does here.
  if (snapshot.unknownAddress) return 'unknown-address';
  // The person can act on it now: Record tries again. A full backlog waits for the disk.
  if (snapshot.encoderGaveUp) return 'encoder-gave-up';
  return snapshot.backlogFull;
}

export function describeTabAlert(
  snapshot: Pick<TabSnapshot, 'backlogFull' | 'encoderGaveUp' | 'unknownAddress'>,
): TabAlert | null {
  const kind = kindOf(snapshot);
  return kind ? { kind, ...ALERTS[kind] } : null;
}
