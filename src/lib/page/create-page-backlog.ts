/**
 * What the meeting page holds that the extension has not taken yet: its limit, and the chunks of
 * its stopped recordings. A recording that stops during an outage (a full disk, a store that
 * hangs, the add-on disabled) keeps its chunks in its own sender until the extension takes them,
 * while the next recording already runs. The limit is for everything the page holds of a kind,
 * recordings with video or audio only, so the running recording counts the stopped ones' chunks
 * too, and a new one waits for them only when they fill it. Until the background has a stopped
 * recording's end, the page claims it, so a fresh background does not save it without them.
 */
import type { ChunkSender } from '@/lib/page/create-chunk-sender';

type StoppedSender = Pick<ChunkSender, 'pendingBytes' | 'whenIdle' | 'settled'>;

export interface PageBacklog {
  /** How many bytes the page may hold of each kind; a recording reads it when it starts. */
  limitBytes(): number;
  /** A recording stopped: what its sender holds counts until the extension has taken it. */
  add(recordingId: string, sender: StoppedSender, withVideo: boolean): void;
  /** The stopped recordings whose end the background has not acked yet. */
  pendingIds(): string[];
  /** The bytes the stopped recordings with video, or those without, still hold. */
  stoppedBytes(withVideo: boolean): number;
  /**
   * Resolves at once while the stopped recordings of that kind hold no more than the limit;
   * otherwise once the extension has taken everything they hold, so that a recording started then
   * does not fill the limit again at its next chunk.
   */
  whenRoom(withVideo: boolean): Promise<void>;
}

export function createPageBacklog(limitBytes: () => number): PageBacklog {
  let stopped: { recordingId: string; sender: StoppedSender; withVideo: boolean }[] = [];
  const ofKind = (withVideo: boolean) => stopped.filter((entry) => entry.withVideo === withVideo);
  const stoppedBytes = (withVideo: boolean): number =>
    ofKind(withVideo).reduce((sum, entry) => sum + entry.sender.pendingBytes(), 0);
  return {
    limitBytes,
    add(recordingId, sender, withVideo) {
      // A settled sender never holds anything again.
      stopped = [
        ...stopped.filter((entry) => !entry.sender.settled()),
        { recordingId, sender, withVideo },
      ];
    },
    pendingIds: () =>
      stopped.filter((entry) => !entry.sender.settled()).map((entry) => entry.recordingId),
    stoppedBytes,
    whenRoom: async (withVideo) => {
      if (stoppedBytes(withVideo) <= limitBytes()) return;
      await Promise.all(ofKind(withVideo).map((entry) => entry.sender.whenIdle()));
    },
  };
}
