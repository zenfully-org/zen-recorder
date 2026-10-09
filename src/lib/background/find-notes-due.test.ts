import { describe, expect, it } from 'vitest';
import type { RecordingMeta } from '@/lib/types';
import { findNotesDue } from './find-notes-due';

const recording = (id: string, patch: Partial<RecordingMeta>): RecordingMeta => ({
  id,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'audio/webm',
  status: 'saved',
  chunkCount: 1,
  byteSize: 1,
  filename: `/dl/zen-recorder/${id}.webm`,
  ...patch,
});

describe('findNotesDue', () => {
  // A background that stopped between the recording's save and its notes writes them at its next
  // start; one that failed three times is left to Retry save.
  it.each([
    ['notes due', { notesState: 'pending' }, true],
    ['a failure, twice', { notesState: 'failed', notesAttempts: 2 }, true],
    ['a failure, three times', { notesState: 'failed', notesAttempts: 3 }, false],
    ['notes written', { notesState: 'saved' }, false],
    ['notes off', { notesState: 'skipped' }, false],
    ['saved before notes existed', {}, false],
    ['not saved yet', { status: 'ended', notesState: 'pending' }, false],
  ] as const)('%s', (_label, patch, due) => {
    expect(findNotesDue([recording('r1', patch)])).toEqual(due ? ['r1'] : []);
  });

  it('passes over what it cannot read', () => {
    expect(
      findNotesDue([{ ...recording('r1', { notesState: 'pending' }), chunkCount: -1 }]),
    ).toEqual([]);
  });
});
