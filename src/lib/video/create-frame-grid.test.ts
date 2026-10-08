import { describe, expect, it } from 'vitest';
import { createFrameGrid } from './create-frame-grid';

/** Places frames drawn at `moments` (s), in order, and returns their timestamps. */
function place(fps: number, moments: readonly number[]): number[] {
  const grid = createFrameGrid(fps);
  return moments.map((moment) => grid.place(moment));
}

describe('createFrameGrid', () => {
  it.each([
    {
      name: 'frames a slot or more apart keep the slot of their moment',
      moments: [0, 0.1, 0.24, 0.4, 0.71],
      stamps: [0, 0.1, 0.2, 0.4, 0.7],
    },
    {
      name: 'a fast frame after a slow one goes to the next slot instead of sharing one',
      moments: [0.16, 0.21],
      stamps: [0.2, 0.3],
    },
    {
      name: 'two frames at one moment (the clock stands still while paused) get a slot each',
      moments: [1, 1],
      stamps: [1, 1.1],
    },
    {
      name: 'a frame after the clock stepped back still comes after the one before it',
      moments: [0.5, 0.42],
      stamps: [0.5, 0.6],
    },
    {
      name: 'a frame that fell behind the grid gets the slot of its moment again',
      moments: [0.16, 0.21, 0.4],
      stamps: [0.2, 0.3, 0.4],
    },
    {
      name: 'a moment before the first slot is never placed before the start of the file',
      moments: [-0.08],
      stamps: [0],
    },
  ])('$name', ({ moments, stamps }) => {
    expect(place(10, moments)).toEqual(stamps);
  });

  it('places every frame exactly on the grid the muxer rounds to, so its rounding moves none', () => {
    const fps = 15;
    const moments = Array.from({ length: 300 }, (_, frame) => frame * 0.0673 + (frame % 3) * 0.02);
    for (const stamp of place(fps, moments)) {
      expect(Math.round(stamp * fps) / fps).toBe(stamp);
    }
  });

  it('is ahead only once the last frame took a slot after the one of the moment', () => {
    const grid = createFrameGrid(10);
    expect(grid.isAhead(0)).toBe(false);
    grid.place(0.16);
    expect(grid.isAhead(0.2)).toBe(false);
    grid.place(0.21);
    // The last frame is in the 0.3 s slot, one after the slot of its moment.
    expect(grid.isAhead(0.24)).toBe(true);
    expect(grid.isAhead(0.26)).toBe(false);
  });

  it('keeps a clock that ticks faster than the grid within a slot of its moments', () => {
    // A 30 fps clock ticks every 33 ms against a grid of 33.3 ms, and the draws vary.
    const fps = 30;
    const grid = createFrameGrid(fps);
    const slot = 1 / fps;
    let last = -1;
    let skipped = 0;
    for (let tick = 0; tick < 10_000; tick++) {
      const at = tick * 0.033;
      if (grid.isAhead(at)) {
        skipped++;
        continue;
      }
      const drawn = at + (tick % 2) * 0.012;
      const stamp = grid.place(drawn);
      expect(stamp).toBeGreaterThan(last);
      expect(stamp - drawn).toBeLessThanOrEqual(1.5 * slot + 1e-9);
      last = stamp;
    }
    // The grid holds 1 % fewer frames than the clock ticks (100): those ticks draw nothing, no others.
    expect(skipped).toBeGreaterThanOrEqual(99);
    expect(skipped).toBeLessThanOrEqual(101);
  });
});
