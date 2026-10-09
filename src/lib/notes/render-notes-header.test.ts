import { describe, expect, it } from 'vitest';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { renderNotesHeader } from './render-notes-header';

type Recording = MeetingNotesDocument['recording'];
type Capture = MeetingNotesDocument['capture'];

const header = (
  recording: Partial<Recording> = {},
  capture: Partial<Capture> = {},
  rest: Partial<MeetingNotesDocument> = {},
) =>
  renderNotesHeader({
    ...EXAMPLE_NOTES,
    ...rest,
    recording: { ...EXAMPLE_NOTES.recording, ...recording },
    capture: { ...EXAMPLE_NOTES.capture, ...capture },
  });
const line = (text: string, label: string) =>
  text.split('\n').find((candidate) => candidate.startsWith(`- **${label}:**`));

describe('renderNotesHeader', () => {
  it.each<[Partial<Recording>, string]>([
    [{ media: 'audio', audioOnlyReason: null }, 'audio only'],
    [{ media: 'audio', audioOnlyReason: 'setting-off' }, 'audio only (video is off in Options)'],
    [
      { media: 'audio', audioOnlyReason: 'no-encoder' },
      'audio only (this browser cannot encode video)',
    ],
    [
      { media: 'audio', audioOnlyReason: 'pipeline-failed' },
      'audio only (the video could not be recorded)',
    ],
    [
      { media: 'audio', audioOnlyReason: 'video-failed' },
      'audio only (the video failed in the previous file)',
    ],
    [{ media: 'audio', audioOnlyReason: 'gpu_lost' }, 'audio only (gpu\\_lost)'],
  ])('says what the file holds: %j', (recording, words) => {
    expect(line(header(recording), 'Recording')).toMatch(
      new RegExp(`, ${words.replace(/[()\\]/g, '\\$&')}$`),
    );
  });

  it('says when the length is not known and the file cannot seek', () => {
    expect(line(header({ durationMs: null, seekable: false }), 'Recording')).toMatch(
      /, length not known, video and audio, not seekable \(it plays from the start\)$/,
    );
  });

  it('links the raw copy and the file a recording continues', () => {
    const text = header({
      rawFile: 'X raw.webm',
      continues: { recordingId: 'rec-0', file: 'X (1).webm', gapMs: 4000 },
    });
    expect(line(text, 'Raw copy')).toBe('- **Raw copy:** [X raw.webm](X%20raw.webm)');
    expect(line(text, 'Continues')).toBe(
      '- **Continues:** [X (1).webm](X%20%281%29.webm), 4 s later',
    );
  });

  it('says it continues a previous file it cannot name, nor tell when', () => {
    const text = header({ continues: { recordingId: 'rec-0', file: null, gapMs: null } });
    expect(line(text, 'Continues')).toBe('- **Continues:** the previous file');
  });

  it('writes no link line without a link', () => {
    expect(
      line(header({}, {}, { meeting: { ...EXAMPLE_NOTES.meeting, url: null } }), 'Link'),
    ).toBeUndefined();
  });

  it('says the end is not known, or estimated, and counts pauses', () => {
    expect(line(header({ end: null }), 'Recorded')).toBe(
      '- **Recorded:** 14:03:05 to an unknown end, paused once for 0:02:42 (not in the file)',
    );
    expect(line(header({ endEstimated: true, pausedMs: 0 }, {}, { events: [] }), 'Recorded')).toBe(
      '- **Recorded:** 14:03:05 to 14:57:47 (estimated from the last saved part)',
    );
    // Time paused, with its pauses missing from the timeline.
    expect(line(header({}, {}, { events: [] }), 'Recorded')).toBe(
      '- **Recorded:** 14:03:05 to 14:57:47, paused for 0:02:42 (not in the file)',
    );
    const twice = [
      ...EXAMPLE_NOTES.events,
      ...EXAMPLE_NOTES.events.filter((event) => event.type === 'recording-paused'),
    ];
    expect(line(header({}, {}, { events: twice }), 'Recorded')).toMatch(/paused twice for/);
  });

  it('writes the day and the offsets of a recording that ends the next day', () => {
    const text = header({ end: '2026-10-05T00:10:00+01:00' });
    expect(text.split('\n')[2]).toBe(
      'Google Meet · Sunday 2026-10-04 · 14:03 to 2026-10-05 00:10 (Europe/Berlin, UTC+02:00 to UTC+01:00)',
    );
  });

  it('says the end of a recording that has none', () => {
    expect(header({ end: null }).split('\n')[2]).toBe(
      'Google Meet · Sunday 2026-10-04 · 14:03 to an unknown end (Europe/Berlin, UTC+02:00)',
    );
  });

  it.each<[string, Partial<Capture>, Partial<MeetingNotesDocument>, string]>([
    [
      'a full list',
      {
        participantSource: 'roster',
        signals: { ...EXAMPLE_NOTES.capture.signals, shareBy: 'observed' },
      },
      {},
      "the call's full participant list, confirmed by the participant count.",
    ],
    [
      'a list and the stage',
      {
        participantSource: 'mixed',
        signals: { ...EXAMPLE_NOTES.capture.signals, share: 'not-available' },
      },
      {},
      "the call's participant list and the people on screen, confirmed by the participant count. Remote screen shares: not shown by Google Meet's page.",
    ],
    [
      'no reading',
      {
        participantSource: 'none',
        signals: { ...EXAMPLE_NOTES.capture.signals, shareBy: 'observed' },
      },
      { events: [] },
      'not observed.',
    ],
    [
      'a start reading without capabilities',
      { signals: { ...EXAMPLE_NOTES.capture.signals, shareBy: 'observed' } },
      {
        events: EXAMPLE_NOTES.events.map((event) =>
          event.type === 'roster' ? { ...event, capabilities: null } : event,
        ),
      },
      'names of people on screen.',
    ],
  ])('says where participants came from: %s', (_label, capture, rest, words) => {
    expect(line(header({}, capture, rest), 'Participants')).toBe(`- **Participants:** ${words}`);
  });

  it.each<[string, Partial<Recording>, Partial<Capture>, string[]]>([
    [
      'recovered',
      { recovered: true },
      { events: 'incomplete', eventsMissingReason: 'recovered' },
      ['**Recovered recording:**'],
    ],
    [
      'events never sent',
      {},
      { events: 'incomplete', eventsMissingReason: 'events-unsent' },
      ['**Incomplete timeline:** some events had not reached'],
    ],
    [
      'events dropped',
      {},
      { events: 'incomplete', eventsMissingReason: 'events-dropped' },
      ['**Incomplete timeline:** the meeting page dropped'],
    ],
    [
      'counts that differ',
      {},
      { events: 'incomplete', eventsMissingReason: 'count-mismatch' },
      ['**Incomplete timeline:** some events are missing, for a reason'],
    ],
    [
      'a reason it does not know',
      {},
      { events: 'incomplete', eventsMissingReason: 'later' },
      ['**Incomplete timeline:** some events are missing.'],
    ],
    [
      'no reason',
      {},
      { events: 'incomplete', eventsMissingReason: null },
      ['**Incomplete timeline:** some events are missing.'],
    ],
  ])('writes a banner for a recording %s', (_label, recording, capture, banners) => {
    const paragraphs = header(recording, capture).split('\n\n').slice(-banners.length);
    expect(
      paragraphs.map((paragraph, index) => paragraph.startsWith(banners[index] ?? '')),
    ).toEqual(banners.map(() => true));
  });
});
