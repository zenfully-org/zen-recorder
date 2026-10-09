import { describe, expect, it } from 'vitest';
import type { RecordingMeta } from '@/lib/types';
import { isRecoveredRecording } from './is-recovered-recording';

function meta(patch: Partial<RecordingMeta>): RecordingMeta {
  return {
    id: 'r1',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    startedAt: 1,
    mimeType: 'audio/webm;codecs=opus',
    status: 'ended',
    chunkCount: 3,
    byteSize: 300,
    ...patch,
  };
}

describe('isRecoveredRecording', () => {
  it.each<{ label: string; recording: RecordingMeta; recovered: boolean }>([
    // Saved now, its tab is gone and nothing ended it.
    { label: 'still recording', recording: meta({ status: 'recording' }), recovered: true },
    { label: 'interrupted', recording: meta({ status: 'interrupted' }), recovered: true },
    {
      label: 'a recovered save that failed',
      recording: meta({ status: 'failed', recovered: true }),
      recovered: true,
    },
    {
      // The save of an interrupted recording stopped half way, and not even `failed` was stored.
      label: 'a recovered save left finalizing',
      recording: meta({ status: 'finalizing', recovered: true }),
      recovered: true,
    },
    { label: 'ended by its page', recording: meta({ status: 'ended' }), recovered: false },
    {
      label: 'a save that failed after a clean end',
      recording: meta({ status: 'failed', recovered: false }),
      recovered: false,
    },
    {
      // Stored before recordings remembered it: nothing says the tab was lost.
      label: 'a failed save stored without the field',
      recording: meta({ status: 'failed' }),
      recovered: false,
    },
  ])('$label: $recovered', ({ recording, recovered }) => {
    expect(isRecoveredRecording(recording)).toBe(recovered);
  });
});
