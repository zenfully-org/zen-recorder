/**
 * The bridge's own end for a page that goes away, after the page's handover: ends every recording
 * that has no end acked or on its way, with the chunks the bridge counted, and says so in
 * Diagnostics. It covers a page session from before the handover, a malformed handover and a
 * recording whose stop was still under way. Runs inside `pagehide`, while the Port still delivers:
 * Port messages arrive in order, so the background stores the chunks relayed so far first. Nothing
 * waits for the acks.
 */
import type { RelayLedger } from '@/lib/bridge/create-relay-ledger';
import type { BackgroundPort } from '@/lib/messaging/create-background-port';

export function endUnended(deps: {
  ledger: Pick<RelayLedger, 'takeUnended'>;
  port: Pick<BackgroundPort, 'send'>;
  log: (message: string) => void;
}): void {
  for (const info of deps.ledger.takeUnended()) {
    const message = `the page went away: recording ${info.recordingId} ended (pagehide) after ${info.chunkCount} chunks`;
    deps.log(message);
    deps.port.send({ type: 'log', log: { level: 'info', message } });
    deps.port.send({ type: 'recordingEnded', info });
  }
}
