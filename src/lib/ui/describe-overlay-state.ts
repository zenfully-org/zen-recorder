import type { LifecycleCommand, RecordingState, TabSnapshot } from '@/lib/types';
import { formatElapsed } from '@/lib/ui/format-elapsed';

/** What the status card shows for a tab, in the words the person recording reads. */
export interface OverlayView {
  /** Picks the status glyph's shape and colour. */
  tone: 'recording' | 'paused' | 'saving' | 'waiting';
  status: string;
  /** How long the recording has run; empty when nothing records. */
  elapsed: string;
  microphone: string;
  /** The video a recording holds; null while nothing records. */
  video: string | null;
  /** The commands the card offers, in the order of its buttons. */
  actions: LifecycleCommand[];
}

const BY_STATE: Record<
  RecordingState,
  { tone: OverlayView['tone']; actions: LifecycleCommand[]; timed: boolean }
> = {
  recording: { tone: 'recording', actions: ['pause', 'stop'], timed: true },
  paused: { tone: 'paused', actions: ['resume', 'stop'], timed: true },
  stopping: { tone: 'saving', actions: [], timed: false },
  waiting: { tone: 'waiting', actions: ['start'], timed: false },
  idle: { tone: 'waiting', actions: ['start'], timed: false },
};

function describeStatus(snapshot: TabSnapshot): string {
  switch (snapshot.state) {
    case 'recording':
      return 'Recording';
    case 'paused':
      return 'Paused';
    case 'stopping':
      return 'Saving…';
    case 'waiting':
      if (!snapshot.admitted) return 'Waiting to be admitted';
      if (snapshot.remoteTracks === 0) return 'Waiting for participants';
      return 'Ready to record';
    case 'idle':
      // Record works on any meeting route, even alone before the call connects.
      return 'Ready to record';
  }
}

function describeVideo(tiles: number | undefined): string {
  if (tiles === undefined) return 'Audio only';
  return `${tiles} tile${tiles === 1 ? '' : 's'}`;
}

export function describeOverlayState(snapshot: TabSnapshot, now: number): OverlayView {
  const { tone, actions, timed } = BY_STATE[snapshot.state];
  const startedAt = timed ? snapshot.recordingStartedAt : null;
  return {
    tone,
    status: describeStatus(snapshot),
    elapsed: startedAt === null ? '' : formatElapsed(now - startedAt),
    microphone: snapshot.micLabel ?? 'Not detected yet',
    video: timed ? describeVideo(snapshot.videoTiles) : null,
    actions,
  };
}
