import { describe, expect, it } from 'vitest';
import type { PageHandover } from '@/lib/types';
import { parsePageHandover } from './parse-page-handover';

const R1 = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const R2 = '9b1d6c3e-2a4f-4e8b-8c7d-1e2f3a4b5c6d';
const chunk = (recordingId: string, seq: number) => ({
  recordingId,
  seq,
  blob: new Blob([`c${seq}`]),
  timestampMs: seq * 3000,
});
const valid: PageHandover = {
  recordings: [
    {
      recordingId: R1,
      chunks: [chunk(R1, 4), chunk(R1, 5)],
      end: { recordingId: R1, chunkCount: 6, durationMs: 16_400, reason: 'pagehide' },
    },
    // A stopped recording whose stop was still under way: no end yet.
    { recordingId: R2, chunks: [], end: null },
  ],
};

describe('parsePageHandover', () => {
  it('accepts what a page holds: unacked chunks and ends, of every recording', () => {
    expect(parsePageHandover(valid)).toEqual(valid);
  });

  it.each([
    ['not an object', 'x'],
    ['no recordings', {}],
    ['a chunk that is not one', { recordings: [{ ...valid.recordings[0], chunks: [{ seq: 1 }] }] }],
    ['a malformed end', { recordings: [{ ...valid.recordings[0], end: { recordingId: R1 } }] }],
    [
      'a chunk of another recording',
      { recordings: [{ recordingId: R1, chunks: [chunk(R2, 0)], end: null }] },
    ],
    [
      "another recording's end",
      {
        recordings: [
          { ...valid.recordings[0], end: { ...valid.recordings[0]?.end, recordingId: R2 } },
        ],
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(parsePageHandover(input)).toBeNull();
  });
});
