import { describe, expect, it, vi } from 'vitest';
import { type RecordingAction, runRecordingAction } from './run-recording-action';

describe('runRecordingAction', () => {
  it('sends the action for the recording and reports no failure when it succeeds', async () => {
    const send = vi.fn(async () => undefined);

    await expect(runRecordingAction('showDownload', 'rec-1', send)).resolves.toBeNull();
    expect(send).toHaveBeenCalledWith('showDownload', { id: 'rec-1' });
  });

  it.each<[string, RecordingAction, unknown, string]>([
    [
      'a download the browser no longer lists',
      'showDownload',
      new Error('Invalid download id 7'),
      'Could not show the file: Invalid download id 7',
    ],
    [
      'a save that fails again',
      'retryFinalize',
      new Error('no chunks stored for this recording'),
      'Could not retry the save: no chunks stored for this recording',
    ],
    [
      'a store that refuses the removal',
      'deleteRecording',
      new Error('The operation failed for reasons unrelated to the database itself'),
      'Could not remove the entry: The operation failed for reasons unrelated to the database itself',
    ],
    [
      'a rejection that is not an Error',
      'showDownload',
      'the background is gone',
      'Could not show the file: the background is gone',
    ],
  ])('says what went wrong for %s', async (_label, action, error, words) => {
    const send = vi.fn(() => Promise.reject(error));

    await expect(runRecordingAction(action, 'rec-1', send)).resolves.toBe(words);
  });
});
