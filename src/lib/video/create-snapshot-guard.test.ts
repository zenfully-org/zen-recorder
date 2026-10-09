import { describe, expect, it } from 'vitest';
import { createSnapshotGuard } from './create-snapshot-guard';

function setup() {
  const logs: string[] = [];
  const guard = createSnapshotGuard({ onLog: (message) => logs.push(message) });
  return { guard, logs, canvas: {}, other: {} };
}

describe('createSnapshotGuard', () => {
  it('allows a canvas whose snapshots are quick, and says nothing', () => {
    const { guard, logs, canvas } = setup();
    expect(guard.allows(canvas, 0)).toBe(true);
    guard.blocked(canvas, 30, 0);
    guard.blocked(canvas, 250, 100);
    expect(guard.allows(canvas, 200)).toBe(true);
    expect(logs).toEqual([]);
  });

  it('holds back a canvas whose snapshot blocked the page for 5 s, then tries it again', () => {
    const { guard, logs, canvas, other } = setup();
    guard.blocked(canvas, 981, 1_000);
    expect(guard.allows(canvas, 1_000)).toBe(false);
    expect(guard.allows(canvas, 5_999)).toBe(false);
    expect(guard.allows(other, 2_000)).toBe(true);
    expect(guard.allows(canvas, 6_000)).toBe(true);
    expect(logs).toEqual([
      'a canvas snapshot blocked the page for 981 ms: its tiles are drawn as placeholders for 5 s',
    ]);
  });

  it('doubles the hold while the canvas keeps blocking, up to a minute', () => {
    const { guard, logs, canvas } = setup();
    let at = 0;
    const holds: number[] = [];
    for (let stall = 0; stall < 6; stall++) {
      guard.blocked(canvas, 10_000, at);
      const until = at;
      while (!guard.allows(canvas, at)) at += 1_000;
      holds.push((at - until) / 1_000);
    }
    expect(holds).toEqual([5, 10, 20, 40, 60, 60]);
    expect(logs.at(-1)).toBe(
      'a canvas snapshot blocked the page for 10000 ms: its tiles are drawn as placeholders for 60 s',
    );
  });

  it('says when the canvas is quick again, and starts over from 5 s', () => {
    const { guard, logs, canvas } = setup();
    guard.blocked(canvas, 900, 0);
    guard.blocked(canvas, 900, 5_000);
    guard.blocked(canvas, 12, 15_000);
    expect(logs.at(-1)).toBe('canvas snapshots are quick again (12 ms)');
    guard.blocked(canvas, 12, 15_100);
    expect(logs).toHaveLength(3);
    guard.blocked(canvas, 700, 20_000);
    expect(guard.allows(canvas, 25_000)).toBe(true);
  });
});
