/**
 * The popup's activity line for a meeting tab: how long its recording has run, or how much remote
 * audio it has while no recording exists. A tab paused before its next recording (a recording that
 * failed while paused restarts on Resume) has no recording, so no elapsed time either.
 */
import type { TabSnapshot } from '@/lib/types';
import { formatElapsed } from '@/lib/ui/format-elapsed';

export function formatTabActivity(snapshot: TabSnapshot, now: number): string {
  const running = snapshot.state === 'recording' || snapshot.state === 'paused';
  return running && snapshot.recordingStartedAt !== null
    ? formatElapsed(now - snapshot.recordingStartedAt)
    : `${snapshot.remoteTracks} remote audio`;
}
