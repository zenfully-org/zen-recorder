import { describe, expect, it } from 'vitest';
import type { RecordingMeta } from '@/lib/types';
import { ABANDONED_AFTER_MS, isAbandonedRecording } from './is-abandoned-recording';

const NOW = 10_000_000;

function meta(patch: Partial<RecordingMeta> = {}): RecordingMeta {
  return {
    id: 'r1',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    startedAt: NOW - 600_000,
    mimeType: 'audio/webm;codecs=opus',
    status: 'recording',
    chunkCount: 3,
    byteSize: 300,
    lastChunkAt: NOW - ABANDONED_AFTER_MS,
    ...patch,
  };
}

/** A recording that started at `startedAt` and has no chunk stored yet. */
function noChunk(startedAt: number): RecordingMeta {
  const { lastChunkAt: _none, ...recording } = meta({ startedAt });
  return recording;
}

const nobody = new Set<string>();

describe('isAbandonedRecording', () => {
  it('waits a minute after the last chunk, the time a page that lives takes to deliver one', () => {
    expect(ABANDONED_AFTER_MS).toBe(60_000);
  });

  it.each<{ label: string; recording: RecordingMeta; claimed?: string[]; abandoned: boolean }>([
    {
      label: 'still recording, unclaimed, its last chunk a minute old',
      recording: meta(),
      abandoned: true,
    },
    {
      label: 'its last chunk just younger than that',
      recording: meta({ lastChunkAt: NOW - ABANDONED_AFTER_MS + 1 }),
      abandoned: false,
    },
    {
      // The page still delivers it, however long ago its last chunk was stored.
      label: 'claimed by a connected tab',
      recording: meta({ lastChunkAt: NOW - 3_600_000 }),
      claimed: ['r1'],
      abandoned: false,
    },
    {
      label: 'no chunk stored, started a minute ago',
      recording: noChunk(NOW - ABANDONED_AFTER_MS),
      abandoned: true,
    },
    {
      label: 'no chunk stored, just started',
      recording: noChunk(NOW - 1000),
      abandoned: false,
    },
    ...(['ended', 'finalizing', 'saved', 'interrupted', 'failed'] as const).map((status) => ({
      label: `${status}, which something ended already`,
      recording: meta({ status }),
      abandoned: false,
    })),
  ])('$label: $abandoned', ({ recording, claimed, abandoned }) => {
    expect(isAbandonedRecording(recording, { claimedIds: new Set(claimed), now: NOW })).toBe(
      abandoned,
    );
  });

  it('takes another wait when given one', () => {
    const recent = meta({ lastChunkAt: NOW - 500 });
    expect(isAbandonedRecording(recent, { claimedIds: nobody, now: NOW, staleMs: 500 })).toBe(true);
    expect(isAbandonedRecording(recent, { claimedIds: nobody, now: NOW, staleMs: 501 })).toBe(
      false,
    );
  });
});
