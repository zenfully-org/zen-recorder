/**
 * Test builds only: lets the end-to-end run take every tab's Port away from the background's side,
 * as an event page that restarted does. A Port disconnected here fires no `onDisconnect` here, so
 * the manager never learns of it, and each bridge reconnects after its delay (`ports:disconnect`).
 * `ports:hold` also drops every Port as it connects, until `ports:release`, so a scenario can
 * record while the Port is down for as long as it needs.
 */

/** A tab's Port as the background sees it. */
interface TabPort {
  disconnect(): void;
  onDisconnect: { addListener(listener: () => void): void };
}

export function createTabPortFaults() {
  const ports = new Set<TabPort>();
  let holding = false;
  const disconnectAll = () => {
    const disconnected = ports.size;
    for (const port of ports) port.disconnect();
    ports.clear();
    return { disconnected };
  };
  return {
    /** False while held: the Port was dropped as it connected, and nothing else may take it. */
    admit(port: TabPort): boolean {
      if (holding) {
        port.disconnect();
        return false;
      }
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
      return true;
    },
    probes: {
      'ports:disconnect': async () => disconnectAll(),
      'ports:hold': async () => {
        holding = true;
        return { ...disconnectAll(), holding };
      },
      'ports:release': async () => {
        holding = false;
        return { holding };
      },
    } satisfies Record<string, () => Promise<unknown>>,
  };
}
