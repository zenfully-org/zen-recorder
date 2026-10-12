import { describe, expect, it } from 'vitest';
import {
  createFakeMediaStreamTrack,
  type FakeMediaStreamTrack,
} from '@/test/fakes/create-fake-media-stream-track';
import { createOwnShares } from './create-own-shares';

/** A page whose shares the test starts (`share`), and how often the session heard of a change. */
function setup() {
  let onScreen: ((track: FakeMediaStreamTrack) => void) | null = null;
  const state = { changes: 0, uninstalled: 0 };
  const shares = createOwnShares(
    (report) => {
      onScreen = report;
      return () => {
        state.uninstalled += 1;
      };
    },
    () => {
      state.changes += 1;
    },
  );
  const share = () => {
    const screen = createFakeMediaStreamTrack({ kind: 'video', label: 'screen' });
    onScreen?.(screen);
    return screen;
  };
  return { shares, share, state };
}

describe('createOwnShares', () => {
  it('says the user shares from the moment the browser gave the screen, and tells the session', () => {
    const { shares, share, state } = setup();
    expect(shares.active()).toBe(false);
    share();
    expect(shares.active()).toBe(true);
    expect(state.changes).toBe(1);
  });

  it('hears a share the browser ended (the user stopped it in the browser)', () => {
    const { shares, share, state } = setup();
    share().end();
    expect(state.changes).toBe(2);
    expect(shares.active()).toBe(false);
  });

  // A page's own track.stop() fires no `ended`: only its state says so, read at the next tick.
  it('sees a share the page stopped by its state', () => {
    const { shares, share, state } = setup();
    const screen = share();
    screen.stop();
    expect(state.changes).toBe(1);
    expect(shares.active()).toBe(false);
  });

  it('shares until the last of two screens ended', () => {
    const { shares, share } = setup();
    const first = share();
    const second = share();
    first.stop();
    expect(shares.active()).toBe(true);
    second.stop();
    expect(shares.active()).toBe(false);
  });

  it('cannot tell without a way to watch the page share', () => {
    const shares = createOwnShares(
      () => null,
      () => undefined,
    );
    expect(shares.active()).toBeNull();
    expect(createOwnShares(undefined, () => undefined).active()).toBeNull();
  });

  it('stops watching once disposed', () => {
    const { shares, share, state } = setup();
    const screen = share();
    shares.dispose();
    screen.end();
    expect(state).toEqual({ changes: 1, uninstalled: 1 });
    expect(shares.active()).toBe(false);
  });
});
