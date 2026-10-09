import { describe, expect, it } from 'vitest';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { renderNotesTimeline } from './render-notes-timeline';

type Started = Extract<NotesEvent, { type: 'recording-started' }>;

const stamp = (seq: number) => ({
  seq,
  at: `2026-10-04T14:10:${String(seq).padStart(2, '0')}+02:00`,
  mediaMs: seq * 1000,
  source: 'page' as const,
});
const started = (patch: Partial<Started> = {}): NotesEvent => ({
  ...stamp(0),
  type: 'recording-started',
  cause: 'manual',
  media: 'video',
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
  mic: 'live',
  tabVisible: true,
  ownShare: false,
  ...patch,
});

/** The text of each row, for a document with `events` and the example's participants. */
const rows = (events: NotesEvent[], patch: Partial<MeetingNotesDocument> = {}) =>
  renderNotesTimeline({ ...EXAMPLE_NOTES, ...patch, events })
    .split('\n')
    .slice(4)
    .map((row) => row.split(' | ')[2]?.replace(/ \|$/, ''));

const anonymous: Partial<MeetingNotesDocument> = {
  capture: { ...EXAMPLE_NOTES.capture, names: false },
};

describe('renderNotesTimeline', () => {
  it.each<[string | null, string]>([
    [
      'page-session-too-old',
      'No timeline: the meeting tab was opened before this version of the extension. Reload the meeting tab to get one next time.',
    ],
    ['notes-off-during-recording', 'No timeline: meeting notes were off while this recording ran.'],
    [null, 'No events were observed.'],
    ['something-new', 'No events were observed.'],
  ])('says why there is no timeline: %s', (reason, words) => {
    const capture = { ...EXAMPLE_NOTES.capture, eventsMissingReason: reason };
    expect(renderNotesTimeline({ ...EXAMPLE_NOTES, capture, events: [] })).toBe(
      `## Timeline\n\n${words}`,
    );
  });

  it.each<[Partial<Started>, string]>([
    [{ cause: null }, 'Recording started'],
    [{ cause: 'hand-raised' }, 'Recording started'],
    [{ cause: 'auto-on-join' }, 'Recording started automatically'],
    [
      { cause: 'restart-after-video-failure', continuesRecordingId: 'rec-0', gapMs: 2000 },
      'Recording started again after the video failed. It continues the previous file, 2 s later',
    ],
    [
      { continuesRecordingId: 'rec-0' },
      'You started the recording. It continues the previous file',
    ],
    [
      { mic: 'not-connected', tabVisible: false, ownShare: true },
      'You started the recording. Your microphone was not connected. The tab was in the background. You were sharing your screen',
    ],
    [{ mic: null, tabVisible: null, ownShare: null }, 'You started the recording'],
  ])('tells a start: %j', (patch, words) => {
    expect(rows([started(patch)])).toEqual([words]);
  });

  it.each<[string, string]>([
    ['command', 'You stopped the recording'],
    ['recovered', 'Recording ends here: the last saved part (recovered)'],
    ['left-meeting', 'Recording stopped: you left the meeting'],
    ['connections-lost', 'Recording stopped'],
  ])('tells a stop for %s', (reason, words) => {
    expect(rows([{ ...stamp(1), type: 'recording-stopped', reason }])).toEqual([words]);
  });

  it('tells joins, leaves, renames and counts by name, or without one', () => {
    const events: NotesEvent[] = [
      { ...stamp(1), type: 'participant-joined', participant: null, count: null },
      { ...stamp(2), type: 'participant-left', participant: null, count: 3 },
      { ...stamp(3), type: 'participant-left', participant: 'p3', count: 3 },
      { ...stamp(4), type: 'participant-renamed', participant: 'p3', from: null },
      { ...stamp(5), type: 'participant-count', count: 1 },
    ];
    expect(rows(events)).toEqual([
      'A participant joined',
      'A participant left (3 in the call)',
      'Left: Ben Carter',
      'Renamed to Ben Carter',
      '1 person in the call',
    ]);
    expect(rows(events, anonymous)).toEqual([
      'A participant joined',
      'A participant left (3 in the call)',
      'A participant left (3 in the call)',
      'A participant was renamed',
      '1 person in the call',
    ]);
  });

  it('tells a join without names by the count, and a return by name', () => {
    const joined: NotesEvent = {
      ...stamp(1),
      type: 'participant-joined',
      participant: 'p4',
      count: 4,
    };
    expect(rows([joined], anonymous)).toEqual(['A participant joined (4 in the call)']);
    expect(rows([joined, { ...joined, seq: 2 }])).toEqual([
      'Joined: Chloé Martin \\| Design',
      'Joined again: Chloé Martin \\| Design',
    ]);
  });

  it('tells shares by whom, as far as the page shows it', () => {
    const shown = {
      capture: {
        ...EXAMPLE_NOTES.capture,
        signals: { ...EXAMPLE_NOTES.capture.signals, shareBy: 'observed' as const },
      },
    };
    expect(rows([{ ...stamp(1), type: 'share-started', by: null }], shown)).toEqual([
      'Someone started sharing a screen',
    ]);
    expect(rows([{ ...stamp(1), type: 'share-stopped', by: 'p4' }])).toEqual([
      'Chloé Martin \\| Design stopped sharing a screen',
    ]);
  });

  it('tells the microphone, from its state at the start', () => {
    const events: NotesEvent[] = [
      started({ mic: 'not-connected' }),
      { ...stamp(1), type: 'mic', state: 'live' },
      { ...stamp(2), type: 'mic', state: 'not-connected' },
    ];
    expect(rows(events).slice(1)).toEqual([
      'Your microphone was connected',
      'Your microphone was disconnected',
    ]);
    // A file without a start: the state before is not known.
    expect(rows([{ ...stamp(1), type: 'mic', state: 'live' }])).toEqual([
      'Your microphone was unmuted',
    ]);
  });

  it('tells a connection lost twice, the call not ending with it, and a return without a loss', () => {
    const events: NotesEvent[] = [
      { ...stamp(1), type: 'connection-lost' },
      { ...stamp(2), type: 'connection-lost' },
      { ...stamp(3), type: 'connection-restored', lostMs: 5000 },
      { ...stamp(4), type: 'connection-restored', lostMs: 2000 },
      { ...stamp(5), type: 'connection-lost' },
    ];
    const ended = { recording: { ...EXAMPLE_NOTES.recording, endReason: 'command' } };
    expect(rows(events, ended)).toEqual([
      "Connection lost (others' audio may be missing)",
      "Connection lost for 5 s (others' audio may be missing)",
      'Connection restored after 2 s',
      "Connection lost (others' audio may be missing)",
    ]);
  });

  it('tells spans a signal was not observed, for reasons and signals of a newer version too', () => {
    const events: NotesEvent[] = [
      { ...stamp(1), type: 'coverage-lost', signal: 'all', reason: 'presence-unavailable' },
      { ...stamp(2), type: 'coverage-restored', signal: 'audio', reason: 'muted_tab' },
      { ...stamp(3), type: 'coverage-lost', signal: 'audio', reason: 'muted_tab' },
    ];
    expect(rows(events)).toEqual([
      'The call was not on screen: nothing was observed until the end',
      'muted\\_tab ended',
      'muted\\_tab: audio may be incomplete until the end',
    ]);
  });

  it('flags an event seen while paused', () => {
    expect(rows([{ ...stamp(1), type: 'participant-count', count: 3, paused: true }])).toEqual([
      '3 people in the call (while paused)',
    ]);
  });
});
