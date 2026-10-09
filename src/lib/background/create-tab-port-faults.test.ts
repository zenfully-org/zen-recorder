import { describe, expect, it } from 'vitest';
import { createTabPortFaults } from './create-tab-port-faults';

/** A tab's Port as the background sees it: it can drop it, and hears when the tab does. */
function fakePort() {
  const listeners: (() => void)[] = [];
  const port = {
    dropped: false,
    disconnect: () => {
      port.dropped = true;
    },
    onDisconnect: { addListener: (listener: () => void) => void listeners.push(listener) },
    /** The tab goes away: Firefox fires `onDisconnect` on this side. */
    close: () => {
      for (const listener of listeners) listener();
    },
  };
  return port;
}

describe('createTabPortFaults', () => {
  it("drops every tab's Port, as an event page that restarted does, and forgets the ones that closed", async () => {
    const faults = createTabPortFaults();
    const [first, second, closed] = [fakePort(), fakePort(), fakePort()];
    expect([first, second, closed].map((port) => faults.admit(port))).toEqual([true, true, true]);
    closed.close();
    expect(await faults.probes['ports:disconnect']()).toEqual({ disconnected: 2 });
    expect([first.dropped, second.dropped, closed.dropped]).toEqual([true, true, false]);
    // A reconnected bridge is admitted again.
    expect(faults.admit(fakePort())).toBe(true);
  });

  it('keeps the Ports down while held, dropping each as it connects, until released', async () => {
    const faults = createTabPortFaults();
    const open = fakePort();
    faults.admit(open);
    expect(await faults.probes['ports:hold']()).toEqual({ disconnected: 1, holding: true });
    expect(open.dropped).toBe(true);
    const reconnecting = fakePort();
    expect(faults.admit(reconnecting)).toBe(false);
    expect(reconnecting.dropped).toBe(true);
    expect(await faults.probes['ports:release']()).toEqual({ holding: false });
    const back = fakePort();
    expect(faults.admit(back)).toBe(true);
    expect(back.dropped).toBe(false);
  });
});
