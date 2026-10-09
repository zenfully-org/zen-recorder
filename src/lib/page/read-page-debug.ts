/**
 * The page's low-level state, which a test build exposes as `__zenRecorderPage.debug()`: the media
 * the capture holds, the running recording's video, backlog and clock, and the meeting events.
 */
import type { FrameStatsSnapshot } from '@/lib/video/create-frame-stats';

export interface PageDebugInfo {
  connections: number;
  remoteAudioTracks: { id: string; muted: boolean; enabled: boolean; readyState: string }[];
  admitted: boolean;
  /** The video pipeline's statistics while a recording with video runs. */
  video: (FrameStatsSnapshot & { fps: number }) | null;
  /** The chunks of the running recording that the bridge has not acked yet. */
  backlog: { bytes: number; chunks: number } | null;
  /** The bytes not acked yet of the page's stopped recordings, by kind. */
  stoppedBacklog: { withVideo: number; audioOnly: number };
  /** Where the running recording is in its file (`Encoder.mediaTimeMs()`), and whether paused. */
  clock: { mediaMs: number; paused: boolean } | null;
  /** The newest recording's meeting events: the protocol, the last seq, pending and acked. */
  notes: { protocol: number; lastSeq: number; pending: number; acked: number };
}

/** What the debug view reads of the running recording. */
interface DebuggedRecording {
  video: { fps(): number; stats(): FrameStatsSnapshot } | null;
  sender: { pendingBytes(): number; pending(): number };
  encoder: { mediaTimeMs(): number; state(): RecordingState };
}

export function readPageDebug(
  capture: { connectionCount(): number; remoteAudioTracks(): MediaStreamTrack[] },
  admitted: boolean,
  recording: DebuggedRecording | null,
  {
    pageBacklog,
    notes,
  }: {
    pageBacklog: { stoppedByKind(): PageDebugInfo['stoppedBacklog'] };
    notes: { debug(): PageDebugInfo['notes'] };
  },
): PageDebugInfo {
  return {
    connections: capture.connectionCount(),
    remoteAudioTracks: capture.remoteAudioTracks().map((t) => ({
      id: t.id,
      muted: t.muted,
      enabled: t.enabled,
      readyState: t.readyState,
    })),
    admitted,
    video: recording?.video ? { fps: recording.video.fps(), ...recording.video.stats() } : null,
    backlog: recording
      ? { bytes: recording.sender.pendingBytes(), chunks: recording.sender.pending() }
      : null,
    stoppedBacklog: pageBacklog.stoppedByKind(),
    clock: recording
      ? { mediaMs: recording.encoder.mediaTimeMs(), paused: recording.encoder.state() === 'paused' }
      : null,
    notes: notes.debug(),
  };
}
