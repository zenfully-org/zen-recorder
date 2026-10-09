/**
 * What the popup's row says of a stored recording, and what it offers. A recording still
 * `recording` that no connected tab claims and that got no chunk for a minute was left unsaved
 * (its tab died and marking it interrupted failed): the row says so and offers Retry save and
 * Remove, instead of looking like a live recording with no button until the next background start.
 * One the background refused to save, because nothing a player could open was recorded, offers
 * Remove only: a retry reads the same chunks and refuses again.
 */
import { isAbandonedRecording } from '@/lib/background/is-abandoned-recording';
import type { RecordingMeta } from '@/lib/types';
import type { RecordingAction } from '@/lib/ui/run-recording-action';

export interface RecordingRowView {
  /** The status in the person's words. */
  status: string;
  /** Drawn as an error: the recording is not saved and waits for the person. */
  attention: boolean;
  /** The row's buttons, in their order. */
  actions: RecordingAction[];
  /** What Remove asks before it deletes the entry. */
  removeQuestion: string;
}

const REMOVE_SAVED = 'Remove this entry? The saved file is kept.';
const REMOVE_UNSAVED = 'Remove this recording? It is not saved: what it recorded is deleted.';

/** A refused recording has nothing a player could open: a retry would refuse again. */
const failedActions = (meta: RecordingMeta): RecordingAction[] =>
  meta.refusal ? ['deleteRecording'] : ['retryFinalize', 'deleteRecording'];

export function describeRecordingRow(
  meta: RecordingMeta,
  context: { claimedIds: ReadonlySet<string>; now: number },
): RecordingRowView {
  const unsaved = { attention: false, removeQuestion: REMOVE_UNSAVED };
  switch (meta.status) {
    case 'saved':
      return {
        status: meta.recovered ? 'saved (recovered)' : 'saved',
        attention: false,
        actions: ['showDownload', 'deleteRecording'],
        removeQuestion: REMOVE_SAVED,
      };
    case 'failed':
      return {
        ...unsaved,
        status: `failed: ${meta.error ?? 'unknown error'}`,
        attention: true,
        actions: failedActions(meta),
      };
    case 'interrupted':
      return { ...unsaved, status: meta.status, actions: ['retryFinalize', 'deleteRecording'] };
    case 'ended':
      return { ...unsaved, status: meta.status, actions: ['deleteRecording'] };
    case 'finalizing':
      return { ...unsaved, status: meta.status, actions: [] };
    case 'recording':
      return isAbandonedRecording(meta, context)
        ? {
            ...unsaved,
            status: 'not saved yet (tab closed)',
            attention: true,
            actions: ['retryFinalize', 'deleteRecording'],
          }
        : { ...unsaved, status: meta.status, actions: [] };
  }
}
