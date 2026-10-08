import { describe, expect, it, vi } from 'vitest';
import { createFrameClock, type FrameClockDeps } from './create-frame-clock';

function setup(overrides: Partial<FrameClockDeps> = {}) {
  vi.useFakeTimers();
  const ticks: { now: number; forced: boolean }[] = [];
  const errors: Error[] = [];
  let draw: boolean | Promise<boolean> = true;
  const clock = createFrameClock({
    fps: 10,
    heartbeatMs: 2000,
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (id) => window.clearInterval(id),
    now: () => Date.now(),
    onTick: (info) => {
      ticks.push(info);
      return draw;
    },
    onError: (e) => errors.push(e),
    ...overrides,
  });
  return { clock, ticks, errors, setDraw: (value: boolean | Promise<boolean>) => (draw = value) };
}

describe('createFrameClock', () => {
  it('ticks at the configured rate once started and stops cleanly', async () => {
    const { clock, ticks } = setup();
    expect(clock.running()).toBe(false);
    clock.start();
    clock.start();
    expect(clock.running()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks.length).toBe(10);
    clock.stop();
    clock.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks.length).toBe(10);
    expect(clock.running()).toBe(false);
  });

  it('forces the first draw and then one per heartbeat when ticks do not draw', async () => {
    const { clock, ticks, setDraw } = setup();
    clock.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks[0]?.forced).toBe(true);
    setDraw(false);
    await vi.advanceTimersByTimeAsync(1900);
    expect(ticks.slice(1).every((t) => !t.forced)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks.at(-1)?.forced).toBe(true);
    // a forced tick that still does not draw keeps forcing
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks.at(-1)?.forced).toBe(true);
  });

  it('skips ticks while a slow draw is still in flight', async () => {
    const { clock, ticks, setDraw } = setup();
    let resolve: (value: boolean) => void = () => undefined;
    setDraw(new Promise<boolean>((r) => (resolve = r)));
    clock.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(ticks.length).toBe(1);
    resolve(true);
    setDraw(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(ticks.length).toBe(3);
  });

  it('reports each tick it skipped because the previous one was still in flight', async () => {
    const busy: number[] = [];
    const { clock, setDraw } = setup({ onBusy: (at) => busy.push(at) });
    let resolve: (value: boolean) => void = () => undefined;
    setDraw(new Promise<boolean>((r) => (resolve = r)));
    clock.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(busy).toHaveLength(2);
    resolve(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(busy).toHaveLength(2);
    clock.stop();
  });

  it('reports draw errors instead of throwing and keeps ticking', async () => {
    const { clock, ticks, errors } = setup({
      onTick: ({ now }) => {
        ticks.push({ now, forced: false });
        if (ticks.length === 1) throw new Error('canvas gone');
        if (ticks.length === 2) throw 'weird';
        return true;
      },
    });
    clock.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(errors.map((e) => e.message)).toEqual(['canvas gone', 'weird']);
    expect(ticks.length).toBe(3);
  });

  it('changes the rate on the fly and clamps it', async () => {
    const { clock, ticks } = setup();
    clock.setFps(5);
    expect(clock.fps()).toBe(5);
    clock.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks.length).toBe(5);
    clock.setFps(5);
    clock.setFps(100);
    expect(clock.fps()).toBe(30);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks.length).toBe(5 + 30);
    clock.setFps(0);
    expect(clock.fps()).toBe(1);
    clock.stop();
  });

  it('runs at a fraction of a rate, such as half of 15 fps', async () => {
    const { clock, ticks } = setup();
    clock.setFps(7.5);
    expect(clock.fps()).toBe(7.5);
    clock.start();
    await vi.advanceTimersByTimeAsync(1_064);
    expect(ticks).toHaveLength(8);
    expect((ticks[1]?.now ?? 0) - (ticks[0]?.now ?? 0)).toBe(133);
    clock.stop();
  });
});
