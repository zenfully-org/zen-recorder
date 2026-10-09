import type { ProviderId, RecordingStartedInfo, TabSnapshot } from '@/lib/types';

/**
 * The page session's tick: once per tick it reads the meeting from the page, so a change it shows
 * is stamped up to this late. Every recording's announcement says it, for the meeting notes.
 */
export const PAGE_TICK_MS = 1_000;

/**
 * The announcement of a recording that just started: the meeting as the page shows it now (read
 * at the moment the recording starts, since it names the file), the encoder's format, the
 * microphone, whether there is video, the meeting-events protocol the page speaks, and its tick.
 */
export function recordingStart(
  recording: {
    id: string;
    startedAt: number;
    encoder: { mimeType(): string };
    video: unknown;
  },
  provider: ProviderId,
  meeting: Pick<TabSnapshot, 'meetingCode' | 'title'>,
  mic: { label: string } | null,
): RecordingStartedInfo {
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
  };
}
