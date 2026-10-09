/**
 * The bridge's Port to the background (`createBackgroundPort`), with its log lines delivered by a
 * `createLogOutbox`: a line is numbered and posted again until the background acks it, so the
 * lines written while the Port was down, or on their way when the background dropped it, still
 * reach Diagnostics. The bridge sends log lines as any other message; the acks stop here.
 */
import {
  type BackgroundPort,
  type BackgroundPortDeps,
  createBackgroundPort,
} from '@/lib/messaging/create-background-port';
import { createLogOutbox } from '@/lib/messaging/create-log-outbox';

export interface BridgePortDeps extends BackgroundPortDeps {
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  /** Picked when the bridge starts, so the background tells its lines from an earlier bridge's. */
  bridgeId: string;
}

export function createBridgePort(deps: BridgePortDeps): BackgroundPort {
  const port = createBackgroundPort({
    ...deps,
    onMessage: (message) => {
      if (message.type === 'logAck') outbox.acked(message.seq);
      else deps.onMessage(message);
    },
  });
  const outbox = createLogOutbox({
    send: (message) => port.send(message),
    bridgeId: deps.bridgeId,
    now: () => Date.now(),
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
  });
  return {
    ...port,
    send: (message) => {
      if (message.type !== 'log') return port.send(message);
      outbox.send(message.log);
      return true;
    },
    close() {
      outbox.dispose();
      port.close();
    },
  };
}
