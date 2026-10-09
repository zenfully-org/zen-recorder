/**
 * The meeting notes format, `zen-recorder/meeting-notes` 1.0, as an executable spec: the zod
 * schema of the JSON block under `## Data`, and the reader that finds it in a notes file.
 * `docs/meeting-notes-format.md` documents every field, and `docs/meeting-notes.schema.json` is
 * generated from this schema (`pnpm notes:schema`).
 *
 * `null` always means "not observed or not known"; the `capture` section says why. Readers of 1.x
 * ignore fields and event types they do not know: unknown fields are dropped when parsing, and an
 * event of an unknown type is left out.
 */
import { z } from 'zod';

/** ISO 8601 to the second, always with the offset of the meeting's time zone at that instant. */
const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
/** Milliseconds: a duration, or a position in the recording's file. */
const ms = z.number().int().nonnegative();
const count = z.number().int().nonnegative();
/** A notes-local participant id (`p1`, `p2`, …), never the service's own id. */
const participantId = z.string().min(1);
const micState = z.enum(['live', 'muted', 'not-connected']);
const signalState = z.enum(['observed', 'partial', 'not-available']);

/**
 * What every event has, in the order every event is written. `paused` and `clamped` are written
 * only when true.
 */
const event = <Type extends string, Shape extends z.ZodRawShape>(type: Type, shape: Shape) =>
  z.object({
    seq: z.number().int().nonnegative(),
    type: z.literal(type),
    at: isoTime,
    mediaMs: ms,
    source: z.enum(['page', 'background']),
    paused: z.literal(true).optional(),
    clamped: z.literal(true).optional(),
    ...shape,
  });

const participantEvent = { participant: participantId.nullable(), count: count.nullable() };
const shareEvent = { by: participantId.nullable() };
const coverageEvent = { signal: z.string(), reason: z.string() };

const EVENTS = [
  event('recording-started', {
    cause: z.string().nullable(),
    media: z.enum(['video', 'audio']).nullable(),
    audioOnlyReason: z.string().nullable(),
    continuesRecordingId: z.string().nullable(),
    gapMs: ms.nullable(),
    mic: micState.nullable(),
    tabVisible: z.boolean().nullable(),
    ownShare: z.boolean().nullable(),
  }),
  event('recording-paused', {}),
  event('recording-resumed', { pausedMs: ms }),
  event('recording-stopped', { reason: z.string() }),
  event('roster', {
    why: z.enum(['start', 'reannounce', 'stop']),
    participantSource: z.enum(['roster', 'stage']).nullable(),
    present: z.array(participantId),
    count: count.nullable(),
    share: z.enum(['none', 'unknown', 'active']),
    shareBy: participantId.nullable(),
    stale: z.boolean(),
    readAt: isoTime,
    capabilities: z
      .object({
        count: z.boolean(),
        roster: z.boolean(),
        self: z.boolean(),
        share: z.boolean(),
        shareBy: z.boolean(),
      })
      .nullable(),
  }),
  event('participant-joined', participantEvent),
  event('participant-left', participantEvent),
  event('participant-renamed', { participant: participantId, from: z.string().nullable() }),
  event('participant-count', { count }),
  event('share-started', shareEvent),
  event('share-stopped', shareEvent),
  event('mic', { state: micState }),
  event('connection-lost', {}),
  event('connection-restored', { lostMs: ms }),
  event('video-failed', {}),
  event('title-changed', { title: z.string() }),
  event('extension-reloaded', {}),
  event('coverage-lost', coverageEvent),
  event('coverage-restored', coverageEvent),
] as const;

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  EVENTS.map((schema) => schema.shape.type.value),
);

export const meetingNotesSchema = z.object({
  schema: z.literal('zen-recorder/meeting-notes'),
  schemaVersion: z.string().regex(/^1\.\d+$/),
  schemaUrl: z.string(),
  generator: z.object({ name: z.literal('zen-recorder'), version: z.string() }),
  meeting: z.object({
    service: z.string(),
    serviceName: z.string(),
    id: z.string(),
    title: z.string().min(1),
    url: z.string().nullable(),
  }),
  recording: z.object({
    id: z.string(),
    file: z.string(),
    rawFile: z.string().nullable(),
    start: isoTime,
    end: isoTime.nullable(),
    timeZone: z.string(),
    durationMs: ms.nullable(),
    pausedMs: ms,
    mediaOffsetMs: ms,
    media: z.enum(['video+audio', 'audio']),
    audioOnlyReason: z.string().nullable(),
    seekable: z.boolean(),
    recovered: z.boolean(),
    endEstimated: z.boolean(),
    startCause: z.string().nullable(),
    endReason: z.string().nullable(),
    continues: z
      .object({ recordingId: z.string(), file: z.string().nullable(), gapMs: ms.nullable() })
      .nullable(),
  }),
  capture: z.object({
    events: z.enum(['complete', 'incomplete', 'none']),
    eventsMissingReason: z.string().nullable(),
    names: z.boolean(),
    participantSource: z.enum(['roster', 'stage', 'mixed', 'none']),
    detectionLatencyMs: ms,
    signals: z.object({
      participants: signalState,
      joinLeave: signalState,
      share: signalState,
      shareBy: signalState,
      self: signalState,
      mic: signalState,
    }),
    coverage: z.array(
      z.object({
        signal: z.string(),
        reason: z.string(),
        fromMs: ms,
        toMs: ms,
        fromAt: isoTime,
        toAt: isoTime,
      }),
    ),
  }),
  participants: z.array(
    z.object({
      id: participantId,
      name: z.string().nullable(),
      names: z.array(z.string()),
      self: z.boolean().nullable(),
      identity: z.enum(['service-id', 'display-name']),
      presentAtStart: z.boolean().nullable(),
      presentAtEnd: z.boolean().nullable(),
      spans: z.array(z.object({ joinedMs: ms.nullable(), leftMs: ms.nullable() })),
    }),
  ),
  events: z.array(z.discriminatedUnion('type', EVENTS)),
});

export type MeetingNotesDocument = z.infer<typeof meetingNotesSchema>;
export type NotesEvent = MeetingNotesDocument['events'][number];
export type NotesParticipant = MeetingNotesDocument['participants'][number];

const typed = z.object({ type: z.string() });

/** Readers of 1.x ignore event types they do not know (a newer minor version adds some). */
const withoutUnknownEvents = (json: unknown): unknown => {
  const document = z.looseObject({ events: z.array(z.unknown()) }).safeParse(json);
  if (!document.success) return json;
  const known = document.data.events.filter((item) => {
    const parsed = typed.safeParse(item);
    return !parsed.success || KNOWN_EVENT_TYPES.has(parsed.data.type);
  });
  return { ...document.data, events: known };
};

/**
 * The document of a notes file: the first fenced `json` block after the heading `## Data`,
 * parsed with the schema. Null when the file has none, or when it does not hold a valid document.
 */
export function parseMeetingNotes(text: string): MeetingNotesDocument | null {
  const heading = text.search(/^## Data$/m);
  if (heading === -1) return null;
  const body = /^```json\n([\s\S]*?)\n```$/m.exec(text.slice(heading))?.[1];
  if (body === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const result = meetingNotesSchema.safeParse(withoutUnknownEvents(json));
  return result.success ? result.data : null;
}
