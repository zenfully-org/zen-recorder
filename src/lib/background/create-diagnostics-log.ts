/**
 * Persistent ring buffer of log lines from the page, the bridge and the background, so a user can
 * copy what happened during a call from the popup after the fact (the Meet tab's console is gone by
 * then). Writes are serialized; the buffer is capped. An entry can come with its own time (a page's
 * line, stamped when its bridge got it, may arrive late): the entries are kept in time order.
 */
import { parseDiagnosticsEntries } from '@/lib/protocol/parse-diagnostics-entries';
import type { DiagnosticsEntry } from '@/lib/types';

export interface DiagnosticsLogDeps {
  load: () => Promise<unknown>;
  save: (entries: DiagnosticsEntry[]) => Promise<void>;
  now?: () => number;
  max?: number;
}

export interface DiagnosticsLog {
  append(entry: Omit<DiagnosticsEntry, 'at'> & { at?: number }): void;
  list(): Promise<DiagnosticsEntry[]>;
  clear(): Promise<void>;
  /** Resolves once every append so far has been persisted. */
  flush(): Promise<void>;
}

export function createDiagnosticsLog(deps: DiagnosticsLogDeps): DiagnosticsLog {
  const now = deps.now ?? (() => Date.now());
  const max = deps.max ?? 400;
  let entries: DiagnosticsEntry[] | null = null;
  let chain: Promise<void> = Promise.resolve();

  const loaded = async (): Promise<DiagnosticsEntry[]> => {
    entries ??= parseDiagnosticsEntries(await deps.load().catch(() => []));
    return entries;
  };

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    chain = chain.then(work).catch(() => undefined);
    return chain;
  };

  return {
    append(entry) {
      void enqueue(async () => {
        const current = await loaded();
        current.push({ ...entry, at: entry.at ?? now() });
        // Stable: entries of the same time keep the order they came in.
        current.sort((a, b) => a.at - b.at);
        if (current.length > max) current.splice(0, current.length - max);
        await deps.save([...current]);
      });
    },
    list: () =>
      enqueue(async () => undefined)
        .then(loaded)
        .then((e) => [...e]),
    clear: () =>
      enqueue(async () => {
        entries = [];
        await deps.save([]);
      }),
    flush: () => enqueue(async () => undefined),
  };
}
