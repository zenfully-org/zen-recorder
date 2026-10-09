import { describeEndReason } from '@/lib/notes/describe-end-reason';
import { describeNotesParticipant } from '@/lib/notes/describe-notes-participant';
import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';
import { formatLocalClock } from '@/lib/notes/format-local-clock';
import { formatMediaOffset } from '@/lib/notes/format-media-offset';
import { formatNotesSpan } from '@/lib/notes/format-notes-span';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';

type Event<Type extends NotesEvent['type']> = Extract<NotesEvent, { type: Type }>;

/** What a row needs beyond its event: the document, the rows merged into earlier ones, state. */
interface Timeline {
  document: MeetingNotesDocument;
  /** Indexes of events already told by an earlier row (a connection restored, a span's end). */
  merged: Set<number>;
  /** Participants seen so far in this file: a join of one of them is a return. */
  seen: Set<string>;
  /** The microphone's last state, to tell "unmuted" from "connected". */
  mic: string | null;
}

/** "The call was not on screen" and the like: why a signal was not observed for a while. */
const REASONS: Readonly<Record<string, string>> = {
  'tab-hidden': 'Tab hidden',
  'presence-unavailable': 'The call was not on screen',
};
const SIGNALS: Readonly<Record<string, string>> = {
  participants: 'people seen on screen may be incomplete',
  share: 'screen shares may be missing',
  all: 'nothing was observed',
};
const reasonWords = (reason: string) => REASONS[reason] ?? escapeMarkdownInline(reason);
const signalWords = (signal: string) =>
  SIGNALS[signal] ?? `${escapeMarkdownInline(signal)} may be incomplete`;

const STARTED: Readonly<Record<string, string>> = {
  'auto-first-remote': 'Recording started automatically',
  'auto-on-join': 'Recording started automatically',
  manual: 'You started the recording',
  'restart-after-video-failure': 'Recording started again after the video failed',
};

const name = (timeline: Timeline, id: string) => describeNotesParticipant(timeline.document, id);
const isSelf = ({ document }: Timeline, id: string | null) =>
  document.participants.some((participant) => participant.id === id && participant.self === true);
const inCall = (count: number | null) => (count === null ? '' : ` (${count} in the call)`);

/** The first event after `index` that `match` accepts, before one `stop` accepts, with its index. */
const findAfter = <Found extends NotesEvent>(
  events: readonly NotesEvent[],
  index: number,
  match: (event: NotesEvent) => event is Found,
  stop: (event: NotesEvent) => boolean,
): { index: number; event: Found } | undefined => {
  const later = events.slice(index + 1);
  const event = later.find(match);
  if (event === undefined) return undefined;
  const at = later.indexOf(event);
  const stopped = later.findIndex(stop);
  return stopped !== -1 && stopped < at ? undefined : { index: index + 1 + at, event };
};

const NOT_CONNECTED = 'not-connected';
const isConnectionLost = (event: NotesEvent) => event.type === 'connection-lost';
const isConnectionRestored = (event: NotesEvent): event is Event<'connection-restored'> =>
  event.type === 'connection-restored';

const isStartRoster = (event: NotesEvent): event is Event<'roster'> =>
  event.type === 'roster' && event.why === 'start';

/** The states at the start that matter only when they are not the usual ones. */
const startStates = (event: Event<'recording-started'>): string[] => [
  ...(event.mic === 'muted' ? ['Your microphone was muted'] : []),
  ...(event.mic === NOT_CONNECTED ? ['Your microphone was not connected'] : []),
  ...(event.tabVisible === false ? ['The tab was in the background'] : []),
  ...(event.ownShare === true ? ['You were sharing your screen'] : []),
];

const continuesSentence = ({
  continuesRecordingId,
  gapMs,
}: Event<'recording-started'>): string[] => {
  if (continuesRecordingId === null) return [];
  const later = gapMs === null ? '' : `, ${formatNotesSpan(gapMs)} later`;
  return [`It continues the previous file${later}`];
};

const describeStart = (event: Event<'recording-started'>, timeline: Timeline): string => {
  const present = timeline.document.events.find(isStartRoster)?.present ?? [];
  for (const id of present) timeline.seen.add(id);
  timeline.mic = event.mic;
  const people = present.map((id) => name(timeline, id));
  return [
    STARTED[event.cause ?? ''] ?? 'Recording started',
    ...continuesSentence(event),
    ...(people.length === 0 ? [] : [`In the call: ${people.join(', ')}`]),
    ...startStates(event),
  ].join('. ');
};

const describeStop = ({ reason }: Event<'recording-stopped'>): string => {
  if (reason === 'connections-lost') return 'Recording stopped';
  if (reason === 'command') return 'You stopped the recording';
  if (reason === 'recovered') return 'Recording ends here: the last saved part (recovered)';
  return `Recording stopped: ${describeEndReason(reason)}`;
};

const RECORDING = new Set<string>([
  'recording-started',
  'recording-paused',
  'recording-resumed',
  'recording-stopped',
  'video-failed',
  'title-changed',
  'extension-reloaded',
]);
type RecordingEvent = Event<
  | 'recording-started'
  | 'recording-paused'
  | 'recording-resumed'
  | 'recording-stopped'
  | 'video-failed'
  | 'title-changed'
  | 'extension-reloaded'
>;
const isRecording = (event: NotesEvent): event is RecordingEvent => RECORDING.has(event.type);

/** The recording's own events. */
const describeRecording = (event: RecordingEvent, timeline: Timeline): string => {
  switch (event.type) {
    case 'recording-started':
      return describeStart(event, timeline);
    case 'recording-paused':
      return 'You paused the recording';
    case 'recording-resumed':
      return `You resumed the recording (${formatMediaOffset(event.pausedMs)} not recorded)`;
    case 'recording-stopped':
      return describeStop(event);
    case 'video-failed':
      return 'The video failed: the meeting goes on in a new file, audio only';
    case 'title-changed':
      return `Title changed to: ${escapeMarkdownInline(event.title)}`;
    case 'extension-reloaded':
      return 'Zen Recorder was reloaded or updated; the recording went on';
  }
};

const describeJoin = (event: Event<'participant-joined'>, timeline: Timeline): string => {
  const { participant } = event;
  if (participant === null || !timeline.document.capture.names) {
    return `A participant joined${inCall(event.count)}`;
  }
  const again = timeline.seen.has(participant);
  timeline.seen.add(participant);
  return `${again ? 'Joined again' : 'Joined'}: ${name(timeline, participant)}`;
};

const describeRename = (event: Event<'participant-renamed'>, timeline: Timeline): string => {
  if (!timeline.document.capture.names) return 'A participant was renamed';
  const now = name(timeline, event.participant);
  return event.from === null
    ? `Renamed to ${now}`
    : `Renamed: ${escapeMarkdownInline(event.from)} → ${now}`;
};

const PEOPLE = new Set<string>([
  'participant-joined',
  'participant-left',
  'participant-renamed',
  'participant-count',
]);
type PeopleEvent = Event<
  'participant-joined' | 'participant-left' | 'participant-renamed' | 'participant-count'
>;
const isPeople = (event: NotesEvent): event is PeopleEvent => PEOPLE.has(event.type);

/** Who is in the call. */
const describePeople = (event: PeopleEvent, timeline: Timeline): string => {
  switch (event.type) {
    case 'participant-joined':
      return describeJoin(event, timeline);
    case 'participant-left':
      return event.participant === null || !timeline.document.capture.names
        ? `A participant left${inCall(event.count)}`
        : `Left: ${name(timeline, event.participant)}`;
    case 'participant-renamed':
      return describeRename(event, timeline);
    case 'participant-count':
      return `${event.count} ${event.count === 1 ? 'person' : 'people'} in the call`;
  }
};

const describeShare = (
  event: Event<'share-started' | 'share-stopped'>,
  timeline: Timeline,
): string => {
  const started = event.type === 'share-started';
  if (isSelf(timeline, event.by)) {
    return started ? 'You started sharing your screen' : 'You stopped sharing your screen';
  }
  if (event.by !== null) {
    return `${name(timeline, event.by)} ${started ? 'started' : 'stopped'} sharing a screen`;
  }
  if (!started) return 'Screen share ended';
  return timeline.document.capture.signals.shareBy === 'not-available'
    ? 'Someone started sharing a screen (presenter not shown by the page)'
    : 'Someone started sharing a screen';
};

const describeMic = (event: Event<'mic'>, timeline: Timeline): string => {
  const before = timeline.mic;
  timeline.mic = event.state;
  if (event.state === 'muted') return 'Your microphone was muted';
  if (event.state === NOT_CONNECTED) return 'Your microphone was disconnected';
  return before === NOT_CONNECTED ? 'Your microphone was connected' : 'Your microphone was unmuted';
};

const describeConnectionLost = (index: number, timeline: Timeline): string => {
  const { events, recording } = timeline.document;
  const restored = findAfter(events, index, isConnectionRestored, isConnectionLost);
  if (restored) {
    timeline.merged.add(restored.index);
    return `Connection lost for ${formatNotesSpan(restored.event.lostMs)} (others' audio may be missing)`;
  }
  const last = !events.slice(index + 1).some(isConnectionLost);
  return last && recording.endReason === 'connections-lost'
    ? 'Connection lost; the call disconnected'
    : "Connection lost (others' audio may be missing)";
};

type CoverageEvent = Event<'coverage-lost' | 'coverage-restored'>;

const describeCoverageLost = (
  event: Event<'coverage-lost'>,
  index: number,
  timeline: Timeline,
): string => {
  const { events } = timeline.document;
  const same =
    (type: CoverageEvent['type']) =>
    (other: NotesEvent): other is CoverageEvent =>
      other.type === type && other.signal === event.signal && other.reason === event.reason;
  const restored = findAfter(events, index, same('coverage-restored'), same('coverage-lost'));
  const what = `${signalWords(event.signal)} until`;
  if (!restored) return `${reasonWords(event.reason)}: ${what} the end`;
  timeline.merged.add(restored.index);
  const span = formatNotesSpan(Date.parse(restored.event.at) - Date.parse(event.at));
  return `${reasonWords(event.reason)} for ${span}: ${what} ${formatMediaOffset(restored.event.mediaMs)}`;
};

type SignalEvent = Exclude<NotesEvent, RecordingEvent | PeopleEvent | Event<'roster'>>;

/** What the recorder could see: shares, the user's microphone, the connection, coverage. */
const describeSignals = (event: SignalEvent, index: number, timeline: Timeline): string => {
  switch (event.type) {
    case 'share-started':
    case 'share-stopped':
      return describeShare(event, timeline);
    case 'mic':
      return describeMic(event, timeline);
    case 'connection-lost':
      return describeConnectionLost(index, timeline);
    case 'connection-restored':
      return `Connection restored after ${formatNotesSpan(event.lostMs)}`;
    case 'coverage-lost':
      return describeCoverageLost(event, index, timeline);
    case 'coverage-restored':
      return `${reasonWords(event.reason)} ended`;
  }
};

/** A row's text, or null for an event no row tells: a reading (`roster`). */
const describeEvent = (event: NotesEvent, index: number, timeline: Timeline): string | null => {
  if (isRecording(event)) return describeRecording(event, timeline);
  if (isPeople(event)) return describePeople(event, timeline);
  if (event.type === 'roster') return null;
  return describeSignals(event, index, timeline);
};

/** Why a file has no timeline at all. */
const NO_TIMELINE: Readonly<Record<string, string>> = {
  'page-session-too-old':
    'No timeline: the meeting tab was opened before this version of the extension. Reload the meeting tab to get one next time.',
  'notes-off-during-recording': 'No timeline: meeting notes were off while this recording ran.',
};

/**
 * The `## Timeline` section: one row per event, in order, with the local time, the position in
 * the file and what happened. Related events share a row (a connection lost and restored, a
 * span a signal was not observed), and a reading (`roster`) is told by the start row and the
 * participants table.
 */
export function renderNotesTimeline(document: MeetingNotesDocument): string {
  const { events, capture } = document;
  if (events.length === 0) {
    const why = NO_TIMELINE[capture.eventsMissingReason ?? ''] ?? 'No events were observed.';
    return ['## Timeline', '', why].join('\n');
  }
  // The start row sets the microphone's state at the start.
  const timeline: Timeline = { document, merged: new Set(), seen: new Set(), mic: null };
  const rows = events.flatMap((event, index) => {
    if (timeline.merged.has(index)) return [];
    const text = describeEvent(event, index, timeline);
    if (text === null) return [];
    const flags = `${event.paused ? ' (while paused)' : ''}${event.clamped ? ' (placed at the end of the file)' : ''}`;
    const time = formatLocalClock(event.at, document.recording.start);
    return [`| ${time} | ${formatMediaOffset(event.mediaMs)} | ${text}${flags} |`];
  });
  return ['## Timeline', '', '| Time | In file | What happened |', '|---|---|---|', ...rows].join(
    '\n',
  );
}
