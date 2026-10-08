/** The requests the popup sends to the background for one saved recording. */
export type RecordingAction = 'showDownload' | 'retryFinalize' | 'deleteRecording';

const WHAT_FAILED: Record<RecordingAction, string> = {
  showDownload: 'Could not show the file',
  retryFinalize: 'Could not retry the save',
  deleteRecording: 'Could not remove the entry',
};

/**
 * Sends a recording's request to the background. Resolves with what to tell the person when it
 * fails, the reason included, or with `null` when it worked: a failed click is never silent.
 */
export function runRecordingAction(
  action: RecordingAction,
  recordingId: string,
  send: (action: RecordingAction, data: { id: string }) => Promise<unknown>,
): Promise<string | null> {
  return send(action, { id: recordingId }).then(
    () => null,
    (error: unknown) =>
      `${WHAT_FAILED[action]}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
