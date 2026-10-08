/**
 * The recordings that connected tabs still claim: the one each page writes, and the stopped ones
 * whose chunks or end it has not handed over yet. The background leaves a claimed recording to
 * its page, which still delivers it, rather than saving it without what the page holds.
 */
import type { TabSnapshot } from '@/lib/types';

export function recordingsClaimedBy(snapshots: readonly (TabSnapshot | null)[]): string[] {
  return snapshots.flatMap((snapshot) =>
    snapshot
      ? [
          ...(snapshot.recordingId ? [snapshot.recordingId] : []),
          ...(snapshot.pendingRecordingIds ?? []),
        ]
      : [],
  );
}
