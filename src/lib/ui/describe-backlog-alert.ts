/**
 * What the person recording reads when the meeting page holds as much as it may of what could not
 * be saved yet (`TabSnapshot.backlogFull`): a few words, the whole of it, and the toast that tells
 * it once. The status card and the popup say it in the same words.
 */
import type { BacklogFull } from '@/lib/types';

export interface BacklogAlert {
  label: string;
  detail: string;
  toast: string;
}

const ALERTS: Record<BacklogFull, BacklogAlert> = {
  'audio-only': {
    label: 'Audio only',
    detail:
      'The video stopped: this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only. Keep this tab open until it is saved.',
    toast:
      'Zen Recorder: the video stopped, because this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only; keep this tab open until it is saved.',
  },
  waiting: {
    label: 'Waiting for space',
    detail:
      'Nothing records: this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
    toast:
      'Zen Recorder: nothing records now, because this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
  },
};

export function describeBacklogAlert(backlogFull: BacklogFull | undefined): BacklogAlert | null {
  return backlogFull ? ALERTS[backlogFull] : null;
}
