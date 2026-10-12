import type {
  ProviderId,
  RecordingStartedInfo,
  RecordingStartFacts,
  StartCause,
  TabSnapshot,
} from '@/lib/types';

/**
 * The page session's tick: once per tick it reads the meeting from the page, so a change it shows
 * is stamped up to this late. Every recording's announcement says it, for the meeting notes.
 */
export const PAGE_TICK_MS = 1_000;

/**
 * The announcement of a recording that just started: the meeting as the page shows it now (read
 * at the moment the recording starts, since it names the file), the encoder's format, the
 * microphone, whether there is video, the meeting-events protocol the page speaks, its tick, and
 * what its start event says of it (`facts`), which the background keeps for the notes' header.
 */
export function recordingStart(
  recording: {
    id: string;
    startedAt: number;
    encoder: { mimeType(): string };
    video: unknown;
  },
  about: {
    provider: ProviderId;
    meeting: Pick<TabSnapshot, 'meetingCode' | 'title'>;
    mic: { label: string } | null;
    facts: RecordingStartFacts & { cause: StartCause };
  },
): RecordingStartedInfo {
  const { provider, meeting, mic, facts } = about;
  const { cause, audioOnlyReason, continuesRecordingId, gapMs } = facts;
  return {
    recordingId: recording.id,
    provider,
    meetingCode: meeting.meetingCode ?? 'unknown',
    title: meeting.title,
    startedAt: recording.startedAt,
    mimeType: recording.encoder.mimeType(),
    micLabel: mic?.label ?? null,
    ...(recording.video ? { hasVideo: true } : {}),
    // The meeting-events protocol this page speaks.
    eventsProtocol: 1,
    tickMs: PAGE_TICK_MS,
    startCause: cause,
    ...(audioOnlyReason === null ? {} : { audioOnlyReason }),
    ...(continuesRecordingId === null ? {} : { continuesRecordingId }),
    ...(gapMs === null ? {} : { gapMs }),
  };
}
