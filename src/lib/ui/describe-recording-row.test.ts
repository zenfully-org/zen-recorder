import { describe, expect, it } from 'vitest';
import type { RecordingMeta } from '@/lib/types';
import { describeRecordingRow, type RecordingRowView } from './describe-recording-row';

const NOW = 10_000_000;
const SAVED_QUESTION = 'Remove this entry? The saved file is kept.';
const UNSAVED_QUESTION = 'Remove this recording? It is not saved: what it recorded is deleted.';

function meta(patch: Partial<RecordingMeta>): RecordingMeta {
  return {
    id: 'r1',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    startedAt: NOW - 600_000,
    mimeType: 'audio/webm;codecs=opus',
    status: 'saved',
    chunkCount: 3,
    byteSize: 300,
    ...patch,
  };
}

/** A recording still `recording` whose last chunk came a minute ago. */
const quiet = { status: 'recording', lastChunkAt: NOW - 60_000 } as const;

describe('describeRecordingRow', () => {
  it.each<{ label: string; recording: RecordingMeta; claimed?: string[]; view: RecordingRowView }>([
    {
      label: 'saved',
      recording: meta({}),
      view: {
        status: 'saved',
        attention: false,
        actions: ['showDownload', 'deleteRecording'],
        removeQuestion: SAVED_QUESTION,
      },
    },
    {
      label: 'saved as recovered',
      recording: meta({ recovered: true }),
      view: {
        status: 'saved (recovered)',
        attention: false,
        actions: ['showDownload', 'deleteRecording'],
        removeQuestion: SAVED_QUESTION,
      },
    },
    {
      label: 'failed',
      recording: meta({ status: 'failed', error: 'download interrupted: FILE_FAILED' }),
      view: {
        status: 'failed: download interrupted: FILE_FAILED',
        attention: true,
        actions: ['retryFinalize', 'deleteRecording'],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'failed without a reason',
      recording: meta({ status: 'failed' }),
      view: {
        status: 'failed: unknown error',
        attention: true,
        actions: ['retryFinalize', 'deleteRecording'],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'interrupted',
      recording: meta({ status: 'interrupted' }),
      view: {
        status: 'interrupted',
        attention: false,
        actions: ['retryFinalize', 'deleteRecording'],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'ended',
      recording: meta({ status: 'ended' }),
      view: {
        status: 'ended',
        attention: false,
        actions: ['deleteRecording'],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'being saved',
      recording: meta({ status: 'finalizing' }),
      view: {
        status: 'finalizing',
        attention: false,
        actions: [],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      // Its tab is gone and nothing ended it: what is stored can be saved now.
      label: 'still recording, unclaimed, no chunk for a minute',
      recording: meta(quiet),
      view: {
        status: 'not saved yet (tab closed)',
        attention: true,
        actions: ['retryFinalize', 'deleteRecording'],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'still recording in a connected tab',
      recording: meta(quiet),
      claimed: ['r1'],
      view: {
        status: 'recording',
        attention: false,
        actions: [],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
    {
      label: 'still recording, its last chunk recent',
      recording: meta({ ...quiet, lastChunkAt: NOW - 1000 }),
      view: {
        status: 'recording',
        attention: false,
        actions: [],
        removeQuestion: UNSAVED_QUESTION,
      },
    },
  ])('$label', ({ recording, claimed, view }) => {
    expect(describeRecordingRow(recording, { claimedIds: new Set(claimed), now: NOW })).toEqual(
      view,
    );
  });
});
