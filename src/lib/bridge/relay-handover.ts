/**
 * Runs inside `pagehide`, in the page's own task: sends on the Port what the page handed over and
 * the background does not have yet, each recording's chunks in order and then its end, and says
 * so in Diagnostics. The Port still delivers there, and in order. A second handover of the same
 * recordings sends only what the first did not get to.
 */
import type { RelayLedger } from '@/lib/bridge/create-relay-ledger';
import type { BackgroundPort } from '@/lib/messaging/create-background-port';
import type { PageHandover } from '@/lib/types';

export function relayHandover(
  handover: PageHandover,
  deps: { ledger: RelayLedger; port: Pick<BackgroundPort, 'send'>; log: (message: string) => void },
): void {
  for (const held of handover.recordings) {
    const { chunks, end } = deps.ledger.handOver(held, {
      chunk: (chunk) => deps.port.send({ type: 'chunk', chunk }),
      end: (info) => deps.port.send({ type: 'recordingEnded', info }),
    });
    if (chunks.length === 0 && !end) continue;
    const ending = end ? ` and its end (${end.chunkCount} chunks in all)` : '';
    const message = `the page went away: it handed over ${chunks.length} more chunks of recording ${held.recordingId}${ending}`;
    deps.log(message);
    deps.port.send({ type: 'log', log: { level: 'info', message } });
  }
}
