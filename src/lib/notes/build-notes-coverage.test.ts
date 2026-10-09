import { describe, expect, it } from 'vitest';
import type { NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { buildNotesCoverage } from './build-notes-coverage';

const base = (seq: number, mediaMs: number, at: string) => ({
  seq,
  mediaMs,
  at: `2026-10-04T14:${at}+02:00`,
  source: 'page' as const,
});
const END = { at: '2026-10-04T14:59:00+02:00', mediaMs: 3_000_000 };

describe('buildNotesCoverage', () => {
  it('finds nothing in a timeline without gaps, pauses or losses', () => {
    const events: NotesEvent[] = [{ ...base(0, 0, '00:00'), type: 'connection-lost' }];
    expect(buildNotesCoverage(events, END)).toEqual([]);
  });

  it('ends a pause the recording ended in at the end, and a span still lost at the end', () => {
    const events: NotesEvent[] = [
      {
        ...base(0, 1_000, '01:00'),
        type: 'coverage-lost',
        signal: 'participants',
        reason: 'tab-hidden',
      },
      // A return of another signal, or for another reason, does not end it.
      {
        ...base(1, 2_000, '02:00'),
        type: 'coverage-restored',
        signal: 'share',
        reason: 'tab-hidden',
      },
      {
        ...base(2, 3_000, '03:00'),
        type: 'coverage-restored',
        signal: 'participants',
        reason: 'presence-unavailable',
      },
      { ...base(3, 5_000, '05:00'), type: 'recording-paused' },
    ];
    expect(buildNotesCoverage(events, END)).toEqual([
      {
        signal: 'all',
        reason: 'paused',
        fromMs: 5_000,
        toMs: 5_000,
        fromAt: '2026-10-04T14:05:00+02:00',
        toAt: END.at,
      },
      {
        signal: 'participants',
        reason: 'tab-hidden',
        fromMs: 1_000,
        toMs: END.mediaMs,
        fromAt: '2026-10-04T14:01:00+02:00',
        toAt: END.at,
      },
    ]);
  });

  it('marks every gap in the seqs between the events around it', () => {
    const events: NotesEvent[] = [
      { ...base(0, 0, '00:00'), type: 'connection-lost' },
      { ...base(3, 9_000, '09:00'), type: 'connection-lost' },
      { ...base(4, 10_000, '10:00'), type: 'connection-lost' },
      { ...base(7, 20_000, '20:00'), type: 'connection-lost' },
    ];
    expect(
      buildNotesCoverage(events, END).map(({ fromMs, toMs, reason }) => ({ fromMs, toMs, reason })),
    ).toEqual([
      { fromMs: 0, toMs: 9_000, reason: 'events-dropped' },
      { fromMs: 10_000, toMs: 20_000, reason: 'events-dropped' },
    ]);
  });
});
