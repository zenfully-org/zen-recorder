import { describe, expect, it } from 'vitest';
import type { NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { deriveNotesSignals } from './derive-notes-signals';

const at = '2026-10-04T14:00:00+02:00';
const roster = (
  why: 'start' | 'stop' | 'reannounce',
  participantSource: 'roster' | 'stage' | null,
  capabilities: {
    count: boolean;
    roster: boolean;
    self: boolean;
    share: boolean;
    shareBy: boolean;
  } | null = null,
): NotesEvent => ({
  seq: 1,
  type: 'roster',
  at,
  mediaMs: 0,
  source: 'page',
  why,
  participantSource,
  present: [],
  count: null,
  share: 'none',
  shareBy: null,
  stale: false,
  readAt: at,
  capabilities,
});
const ALL = { count: true, roster: true, self: true, share: true, shareBy: true };
const NONE = { count: false, roster: false, self: false, share: false, shareBy: false };

describe('deriveNotesSignals', () => {
  it('reads the example as its notes say: people on screen, a count, no sharer', () => {
    expect(deriveNotesSignals(EXAMPLE_NOTES.events)).toEqual({
      participantSource: 'stage',
      signals: EXAMPLE_NOTES.capture.signals,
    });
  });

  it('knows nothing about people without a reading, nor the microphone without a state', () => {
    expect(deriveNotesSignals([])).toEqual({
      participantSource: 'none',
      signals: {
        participants: 'not-available',
        joinLeave: 'not-available',
        share: 'not-available',
        shareBy: 'not-available',
        self: 'not-available',
        mic: 'not-available',
      },
    });
  });

  it('observes everyone from a full roster', () => {
    const derived = deriveNotesSignals([roster('start', 'roster', ALL), roster('stop', 'roster')]);
    expect(derived.participantSource).toBe('roster');
    expect(derived.signals).toMatchObject({
      participants: 'observed',
      joinLeave: 'observed',
      self: 'observed',
    });
  });

  it('says a stage without a count tells joins and leaves only in part', () => {
    const derived = deriveNotesSignals([roster('start', 'stage', NONE)]);
    expect(derived.signals).toMatchObject({
      participants: 'partial',
      joinLeave: 'partial',
      share: 'not-available',
    });
  });

  it('says mixed when readings came from both a roster and the stage', () => {
    expect(
      deriveNotesSignals([roster('start', 'stage', ALL), roster('reannounce', 'roster')])
        .participantSource,
    ).toBe('mixed');
  });

  it('knows nothing of joins without a start reading, nor of a reading without a source', () => {
    const derived = deriveNotesSignals([roster('reannounce', null)]);
    expect(derived.participantSource).toBe('none');
    expect(derived.signals.joinLeave).toBe('not-available');
  });

  it('observes the microphone from a mic event alone', () => {
    const mic: NotesEvent = { seq: 2, type: 'mic', at, mediaMs: 0, source: 'page', state: 'muted' };
    expect(deriveNotesSignals([mic]).signals.mic).toBe('observed');
  });
});
