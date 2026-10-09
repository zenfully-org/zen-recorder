/**
 * What the background does with the recordings of a meeting tab whose Port dropped before their
 * end arrived. The Port drops for two reasons:
 *   - The tab was closed. The bridge ends its recordings inside `pagehide`, but on a tab closed
 *     while the machine is busy Firefox can drop that Port message: the parent tears the tab's
 *     window actor down before the message arrives, and ConduitsParent refuses a message from an
 *     actor it no longer knows (toolkit/components/extensions/ConduitsParent.sys.mjs). The
 *     browser still reports the closed tab (`tabs.onRemoved`), so its recordings end at once,
 *     under their own name, with every chunk that was stored.
 *   - The tab died without closing: its content process crashed, or the extension reloaded. Its
 *     recordings are interrupted once a grace for a reconnect is over, and saved as "(recovered)".
 * Either way the decision waits until the tab's queue has handled every message it received: a
 * chunk still in it belongs in the file. A chunk stored after that came through another Port, so
 * the page is alive and its recording is left to it.
 */
import { recordingsClaimedBy } from '@/lib/background/recordings-claimed-by';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { TabSnapshot } from '@/lib/types';

interface LostTab {
  tabId: number;
  /** The tab's last snapshot: the recordings it claimed. */
  snapshot: TabSnapshot | null;
  /** The tab's message queue, which settles once it has handled what it received. */
  queue: Promise<void>;
}

export interface LostTabs {
  /** The Port of a connected tab dropped. */
  lost(tab: LostTab): void;
  /** The browser closed tab `tabId` (`tabs.onRemoved`), before or after its Port dropped. */
  closed(tabId: number): void;
}

export interface LostTabsDeps {
  store: Pick<ChunkStore, 'getRecording' | 'updateRecording'>;
  finalize: (recordingId: string, options: { recovered: boolean }) => Promise<unknown>;
  setTimeout: (handler: () => void, ms: number) => unknown;
  /** How long a lost tab that was not closed has to reconnect. */
  graceMs: number;
  now: () => number;
  warn: (message: string, detail?: unknown) => void;
  /** The recordings the connected tabs claim now: a page that reconnected still delivers them. */
  claimedNow: () => string[];
  /** Whether tab `tabId` has a Port now: the browser can report a tab closed before it drops. */
  isConnected: (tabId: number) => boolean;
}

interface Tracked {
  closed: boolean;
  /** Set once the tab's queue has drained and the grace runs. */
  settle: ((closed: boolean) => void) | null;
}

export function createLostTabs(deps: LostTabsDeps): LostTabs {
  const tracked = new Map<number, Tracked>();

  const end = async (recordingId: string, drainedAt: number, closed: boolean): Promise<void> => {
    const meta = await deps.store.getRecording(recordingId);
    if (meta?.status !== 'recording') return;
    if (meta.lastChunkAt !== undefined && meta.lastChunkAt > drainedAt) return;
    if (closed) {
      deps.warn(
        `the tab of recording ${recordingId} was closed before its end reached the background: saved under its own name with the ${meta.chunkCount} chunks stored`,
      );
    }
    await deps.store.updateRecording(recordingId, {
      status: closed ? 'ended' : 'interrupted',
      endedAt: deps.now(),
    });
    await deps.finalize(recordingId, { recovered: !closed });
  };

  const decide = (tab: LostTab, entry: Tracked, claimed: string[]): void => {
    const drainedAt = deps.now();
    let done = false;
    const settle = (closed: boolean): void => {
      if (done) return;
      done = true;
      tracked.delete(tab.tabId);
      const reconnected = deps.claimedNow();
      for (const recordingId of claimed.filter((id) => !reconnected.includes(id))) {
        // When the store fails (a full disk, a closed database), the recording keeps its chunks
        // and stays unsaved: the recovery pass of the next background start saves it.
        void end(recordingId, drainedAt, closed).catch((error: unknown) =>
          deps.warn(
            closed
              ? `could not save recording ${recordingId} of a closed tab:`
              : `could not interrupt ${recordingId}:`,
            error,
          ),
        );
      }
    };
    if (entry.closed) {
      settle(true);
      return;
    }
    entry.settle = settle;
    deps.setTimeout(() => settle(false), deps.graceMs);
  };

  return {
    lost(tab) {
      const claimed = recordingsClaimedBy([tab.snapshot]);
      if (claimed.length === 0) {
        tracked.delete(tab.tabId);
        return;
      }
      const entry = tracked.get(tab.tabId) ?? { closed: false, settle: null };
      tracked.set(tab.tabId, entry);
      void tab.queue.then(() => decide(tab, entry, claimed));
    },
    closed(tabId) {
      const entry = tracked.get(tabId);
      if (entry) {
        entry.closed = true;
        entry.settle?.(true);
      } else if (deps.isConnected(tabId)) {
        tracked.set(tabId, { closed: true, settle: null });
      }
    },
  };
}
