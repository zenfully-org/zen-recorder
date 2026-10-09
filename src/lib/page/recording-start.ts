import type { ProviderId, RecordingStartedInfo, TabSnapshot } from '@/lib/types';

/**
 * The announcement of a recording that just started: the meeting as the page shows it now (read
 * at the moment the recording starts, since it names the file), the encoder's format, the
 * microphone, whether there is video, and the meeting-events protocol the page speaks.
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
  };
}
