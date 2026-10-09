import { countTimes } from '@/lib/notes/count-times';
import { describeEndReason } from '@/lib/notes/describe-end-reason';
import { describeStartCause } from '@/lib/notes/describe-start-cause';
import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';
import { formatLocalClock } from '@/lib/notes/format-local-clock';
import { formatMediaOffset } from '@/lib/notes/format-media-offset';
import { formatNotesSpan } from '@/lib/notes/format-notes-span';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';
import { summarizeNotesMicrophone } from '@/lib/notes/summarize-notes-microphone';

type Recording = MeetingNotesDocument['recording'];

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const weekday = (iso: string): string =>
  WEEKDAY.format(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`));
const clock = (iso: string): string => iso.slice(11, 19);
const minutes = (iso: string): string => iso.slice(11, 16);
const offset = (iso: string): string => `UTC${iso.slice(19)}`;

/** A file name as a link next to the notes: percent-encoded, brackets too, for every renderer. */
const link = (file: string): string =>
  `[${escapeMarkdownInline(file)}](${encodeURIComponent(file).replaceAll('(', '%28').replaceAll(')', '%29')})`;

const AUDIO_ONLY: Readonly<Record<string, string>> = {
  'setting-off': 'audio only (video is off in Options)',
  'no-encoder': 'audio only (this browser cannot encode video)',
  'pipeline-failed': 'audio only (the video could not be recorded)',
  'video-failed': 'audio only (the video failed in the previous file)',
};

const describeMedia = ({ media, audioOnlyReason }: Recording): string => {
  if (media === 'video+audio') return 'video and audio';
  if (audioOnlyReason === null) return 'audio only';
  return AUDIO_ONLY[audioOnlyReason] ?? `audio only (${escapeMarkdownInline(audioOnlyReason)})`;
};

/** Where the recording ends on the clock: its time, with its date when it is another day. */
const until = (start: string, end: string | null): string => {
  if (end === null) return 'an unknown end';
  if (end.slice(0, 10) === start.slice(0, 10)) return minutes(end);
  return `${end.slice(0, 10)} ${minutes(end)}`;
};

/** The offsets from UTC, both when the recording crossed a change of daylight saving time. */
const offsets = (start: string, end: string | null): string =>
  end === null || offset(end) === offset(start)
    ? offset(start)
    : `${offset(start)} to ${offset(end)}`;

/** The service, the day and the span of the recording in its time zone. */
const describeDay = ({ meeting, recording }: MeetingNotesDocument): string => {
  const { start, end, timeZone } = recording;
  const day = `${weekday(start)} ${start.slice(0, 10)}`;
  const span = `${minutes(start)} to ${until(start, end)}`;
  const zone = `${escapeMarkdownInline(timeZone)}, ${offsets(start, end)}`;
  return `${escapeMarkdownInline(meeting.serviceName)} · ${day} · ${span} (${zone})`;
};

/** The time not recorded, and how many pauses it took. */
const describePauses = ({ recording, events }: MeetingNotesDocument): string => {
  const pauses = events.filter((event) => event.type === 'recording-paused').length;
  if (pauses === 0 && recording.pausedMs === 0) return '';
  const times = pauses === 0 ? '' : ` ${countTimes(pauses)}`;
  return `, paused${times} for ${formatMediaOffset(recording.pausedMs)} (not in the file)`;
};

const describeRecorded = (document: MeetingNotesDocument): string => {
  const { recording } = document;
  const end =
    recording.end === null ? 'an unknown end' : formatLocalClock(recording.end, recording.start);
  const estimated = recording.endEstimated ? ' (estimated from the last saved part)' : '';
  return `${clock(recording.start)} to ${end}${estimated}${describePauses(document)}`;
};

const SOURCES: Readonly<Record<MeetingNotesDocument['capture']['participantSource'], string>> = {
  roster: "the call's full participant list",
  stage: 'names of people on screen',
  mixed: "the call's participant list and the people on screen",
  none: 'not observed',
};

const describeParticipants = (document: MeetingNotesDocument): string => {
  const { capture, meeting, events } = document;
  const start = events.find((event) => event.type === 'roster' && event.why === 'start');
  const counted = start?.type === 'roster' && start.capabilities?.count === true;
  const source = `${SOURCES[capture.participantSource]}${counted ? ', confirmed by the participant count' : ''}`;
  const page = `${escapeMarkdownInline(meeting.serviceName)}'s page`;
  const { share, shareBy } = capture.signals;
  if (share === 'not-available') return `${source}. Remote screen shares: not shown by ${page}.`;
  if (shareBy === 'not-available')
    return `${source}. Remote screen shares: who shared is not shown by ${page}.`;
  return `${source}.`;
};

const INCOMPLETE: Readonly<Record<string, string>> = {
  'events-unsent':
    'some events had not reached Zen Recorder when the recording ended, so the timeline may miss its last moments.',
  'events-dropped':
    'the meeting page dropped some events when too many came at once; the coverage in the data block says where.',
  'count-mismatch': 'some events are missing, for a reason Zen Recorder could not tell.',
};

const RECOVERED =
  '**Recovered recording:** the meeting tab closed, or Firefox or the extension stopped, while recording; the file and the timeline end at the last saved part.';

/** The banner of a timeline missing events, for a reason the recovered banner does not tell. */
const incomplete = ({ events, eventsMissingReason }: MeetingNotesDocument['capture']): string[] => {
  if (events !== 'incomplete' || eventsMissingReason === 'recovered') return [];
  const why = INCOMPLETE[eventsMissingReason ?? ''] ?? 'some events are missing.';
  return [`**Incomplete timeline:** ${why}`];
};

const banners = ({ recording, capture }: MeetingNotesDocument): string[] => [
  ...(recording.recovered ? [RECOVERED] : []),
  ...incomplete(capture),
];

/** The file a recording continues, and how long after it it started. */
const describeContinues = ({ continues }: Recording): string[] => {
  if (continues === null) return [];
  const file = continues.file === null ? 'the previous file' : link(continues.file);
  const later = continues.gapMs === null ? '' : `, ${formatNotesSpan(continues.gapMs)} later`;
  return [`- **Continues:** ${file}${later}`];
};

const describeFile = (recording: Recording): string => {
  const length =
    recording.durationMs === null ? 'length not known' : formatMediaOffset(recording.durationMs);
  const seekable = recording.seekable ? '' : ', not seekable (it plays from the start)';
  return `${link(recording.file)}, ${length}, ${describeMedia(recording)}${seekable}`;
};

/**
 * The human part above the participants: the title, the day, where the data block and its
 * documentation are, a short summary of the recording, and a banner when it was recovered or its
 * timeline is incomplete.
 */
export function renderNotesHeader(document: MeetingNotesDocument): string {
  const { meeting, recording } = document;
  const summary = [
    `- **Recording:** ${describeFile(recording)}`,
    ...(recording.rawFile === null ? [] : [`- **Raw copy:** ${link(recording.rawFile)}`]),
    ...describeContinues(recording),
    ...(meeting.url === null ? [] : [`- **Link:** ${meeting.url}`]),
    `- **Recorded:** ${describeRecorded(document)}`,
    `- **Started:** ${describeStartCause(recording.startCause, meeting.service)}`,
    `- **Ended:** ${describeEndReason(recording.endReason)}`,
    `- **Your microphone:** ${summarizeNotesMicrophone(document)}`,
    `- **Participants:** ${describeParticipants(document)}`,
  ];
  return [
    `# ${escapeMarkdownInline(meeting.title)}`,
    '',
    describeDay(document),
    '',
    'Meeting notes by zen-recorder. The `## Data` block at the end is the complete record',
    `(schema \`${document.schema}\` ${document.schemaVersion}, documented at`,
    `${document.schemaUrl}). "In file" is the position in the recording.`,
    '',
    ...summary,
    ...banners(document).flatMap((paragraph) => ['', paragraph]),
  ].join('\n');
}
