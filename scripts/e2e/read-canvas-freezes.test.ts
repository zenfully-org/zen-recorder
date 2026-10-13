// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSnapshotGuard } from '../../src/lib/video/create-snapshot-guard';
import { readCanvasFreezes } from './read-canvas-freezes';

const STARTED_AT = 1_791_000_000_000;

/** The lines the recorder's snapshot guard logs when snapshots of a canvas block for `ms`. */
function guardLines(...blocks: number[]): string[] {
  const lines: string[] = [];
  const guard = createSnapshotGuard({ onLog: (message) => lines.push(message) });
  const canvas = {};
  let at = 0;
  for (const ms of blocks) {
    at += 100_000;
    guard.blocked(canvas, ms, at);
  }
  return lines;
}

const entry = (atMs: number, message: string) => ({
  at: STARTED_AT + atMs,
  level: 'info',
  source: 'page:12',
  message,
});

describe('readCanvasFreezes', () => {
  it('places each freeze the recorder logged on the file, ending when the line was stamped', () => {
    const [first, second, quick] = guardLines(10_001, 9_870, 3);
    const diagnostics = [
      entry(2_000, 'recording started'),
      entry(25_444, `[1lia6m] ${first}`),
      entry(25_446, quick ?? ''),
      entry(48_000, second ?? ''),
      entry(48_100, 'video perf after 32 s: … page frozen 19.9 s by canvas snapshots'),
    ];
    expect(readCanvasFreezes(diagnostics, STARTED_AT)).toEqual([
      { from: 15_443, to: 25_444 },
      { from: 38_130, to: 48_000 },
    ]);
  });

  it('leaves out a freeze that ended before the file began', () => {
    const [line] = guardLines(10_002);
    expect(readCanvasFreezes([entry(-1, line ?? '')], STARTED_AT)).toEqual([]);
  });

  it('throws when the diagnostics probe answers something else', () => {
    expect(() => readCanvasFreezes({ error: 'no such probe' }, STARTED_AT)).toThrow();
  });
});
