/**
 * What the meeting page holds that the extension has not taken yet: its limit, and the chunks of
 * its stopped recordings. A recording that stops during an outage (a full disk, a store that
 * hangs, the add-on disabled) keeps its chunks in its own sender until the extension takes them,
 * while the next recording already runs. The limit is for everything the page holds of a kind,
 * recordings with video or audio only, so the running recording counts the stopped ones' chunks
 * too, and a new one waits for them only when they fill it. Until the background has a stopped
 * recording's end, the page claims it, so a fresh background does not save it without them.
 *
 * While the limit is full the person recording has to know, in their tab: the video stopped, or
 * nothing records at all. The page's snapshot says so (`backlogFull`) for as long as it lasts.
 */
import type { ChunkSender } from '@/lib/page/create-chunk-sender';
import type { HeldRecording, StopReason, TabSnapshot } from '@/lib/types';

type StoppedSender = Pick<ChunkSender, 'pendingBytes' | 'whenIdle' | 'settled' | 'held'>;

export interface PageBacklog {
  /** How many bytes the page may hold of each kind; a recording reads it when it starts. */
  limitBytes(): number;
  /** A recording stopped: what its sender holds counts until the extension has taken it. */
  add(recordingId: string, sender: StoppedSender, withVideo: boolean, reason: StopReason): void;
  /**
   * The page's part of its snapshot: the stopped recordings whose end the background has not
   * acked yet, and whether the limit is full. 'waiting' while a stop waits for room; otherwise
   * 'audio-only' while a recording with video that filled the limit still has chunks or its end in
   * the page, since every recording is audio only until then.
   */
  snapshot(): Pick<TabSnapshot, 'pendingRecordingIds' | 'backlogFull'>;
  /** What each of them still holds, for a page that goes away: unacked chunks and the end. */
  held(): HeldRecording[];
  /** `stoppedBytes` of each kind. */
  stoppedByKind(): { withVideo: number; audioOnly: number };
  /** The bytes the stopped recordings with video, or those without, still hold. */
  stoppedBytes(withVideo: boolean): number;
  /**
   * Resolves at once while the stopped recordings of that kind hold no more than the limit;
   * otherwise once the extension has taken everything they hold, so that a recording started then
   * does not fill the limit again at its next chunk.
   */
  whenRoom(withVideo: boolean): Promise<void>;
}

interface StoppedRecording {
  recordingId: string;
  sender: StoppedSender;
  withVideo: boolean;
  /** It stopped because the chunks the extension had not taken filled the limit. */
  filled: boolean;
}

export function createPageBacklog(limitBytes: () => number): PageBacklog {
  let stopped: StoppedRecording[] = [];
  /** The stops waiting for room: nothing records meanwhile. */
  let waiting = 0;
  const unsettled = () => stopped.filter((entry) => !entry.sender.settled());
  const ofKind = (withVideo: boolean) => stopped.filter((entry) => entry.withVideo === withVideo);
  const stoppedBytes = (withVideo: boolean): number =>
    ofKind(withVideo).reduce((sum, entry) => sum + entry.sender.pendingBytes(), 0);
  const videoFilled = (): boolean => unsettled().some((entry) => entry.withVideo && entry.filled);
  return {
    limitBytes,
    add(recordingId, sender, withVideo, reason) {
      // A settled sender never holds anything again.
      stopped = [
        ...unsettled(),
        { recordingId, sender, withVideo, filled: reason === 'backlog-full' },
      ];
    },
    snapshot() {
      const pendingRecordingIds = unsettled().map((entry) => entry.recordingId);
      if (waiting > 0) return { pendingRecordingIds, backlogFull: 'waiting' };
      return videoFilled()
        ? { pendingRecordingIds, backlogFull: 'audio-only' }
        : { pendingRecordingIds };
    },
    held: () =>
      unsettled().map((entry) => ({ recordingId: entry.recordingId, ...entry.sender.held() })),
    stoppedByKind: () => ({ withVideo: stoppedBytes(true), audioOnly: stoppedBytes(false) }),
    stoppedBytes,
    whenRoom: async (withVideo) => {
      if (stoppedBytes(withVideo) <= limitBytes()) return;
      waiting++;
      await Promise.all(ofKind(withVideo).map((entry) => entry.sender.whenIdle()));
      waiting--;
    },
  };
}
