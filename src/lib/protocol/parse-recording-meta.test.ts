import { describe, expect, it } from 'vitest';
import { parseRecordingMeta } from './parse-recording-meta';

/** What this version stores about a saved recording. */
const current = {
  id: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  provider: 'zoom',
  meetingCode: '123456789',
  title: 'Standup',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_060_000,
  durationMs: 59_800,
  mimeType: 'video/webm;codecs=vp9,opus',
  status: 'saved',
  chunkCount: 20,
  byteSize: 4_000_000,
  filename: '/dl/zen-recorder/2026-10-09_10-00_Standup.webm',
  recovered: false,
  hasVideo: true,
  lastChunkAt: 1_700_000_059_000,
  endReason: 'command',
  endCause: 'ended',
  eventsProtocol: 1,
  eventCount: 2,
  eventsDropped: 0,
  eventsUnsent: 0,
  timeZone: 'Europe/Berlin',
  tickMs: 1_000,
  notesState: 'pending',
  notesAttempts: 1,
  notesError: 'download timed out',
  startOffsetMs: 6,
  remuxed: true,
  rawFilename: '/dl/zen-recorder/2026-10-09_10-00_Standup raw.webm',
};

/** What 0.3.0 stored: no events, no zone, no notes, and from Meet's first builds no provider. */
const v030 = {
  id: 'r-1',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1_700_000_000_000,
  mimeType: 'audio/webm',
  status: 'saved',
  chunkCount: 3,
  byteSize: 9_000,
  filename: '/dl/zen-recorder/a.webm',
};

describe('parseRecordingMeta', () => {
  it('reads what this version stores', () => {
    expect(parseRecordingMeta(current)).toEqual(current);
  });

  // An older recording has no events at all: its notes say the page session was too old.
  it('reads a recording stored by 0.3.0, with the defaults for what it lacks', () => {
    expect(parseRecordingMeta(v030)).toEqual({
      ...v030,
      provider: 'meet',
      recovered: false,
      hasVideo: false,
      eventsProtocol: 0,
      tickMs: 1_000,
      notesAttempts: 0,
      startOffsetMs: 0,
      remuxed: true,
    });
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'r-1'],
    ['no id', { ...v030, id: undefined }],
    ['an unknown status', { ...v030, status: 'lost' }],
    ['a negative chunk count', { ...v030, chunkCount: -1 }],
    ['an unknown notes state', { ...current, notesState: 'later' }],
  ])('refuses %s', (_label, input) => {
    expect(parseRecordingMeta(input)).toBeNull();
  });

  // A field this version does not know (a later one wrote it) is not kept.
  it('drops what it does not know', () => {
    expect(parseRecordingMeta({ ...v030, future: 1 })).not.toHaveProperty('future');
  });
});
