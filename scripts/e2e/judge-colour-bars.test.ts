// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { judgeColourBars } from './judge-colour-bars';

const BARS = [
  '#ffffff',
  '#ffff00',
  '#00ffff',
  '#00ff00',
  '#ff00ff',
  '#ff0000',
  '#0000ff',
  '#000000',
];
type Rgb = readonly [number, number, number];

/** A frame of `width` x `height` pixels: the background, with the colours side by side in a band. */
function frame(colours: readonly Rgb[], options: { barWidth?: number; background?: Rgb } = {}) {
  const barWidth = options.barWidth ?? 40;
  const background = options.background ?? [32, 33, 36];
  const width = colours.length * barWidth + 20;
  const height = 30;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bar =
        y >= 5 && y < 25 && x >= 10 ? colours[Math.floor((x - 10) / barWidth)] : undefined;
      rgb.set(bar ?? background, (y * width + x) * 3);
    }
  }
  return { width, height, rgb };
}

const exact: Rgb[] = [
  [255, 255, 255],
  [255, 255, 0],
  [0, 255, 255],
  [0, 255, 0],
  [255, 0, 255],
  [255, 0, 0],
  [0, 0, 255],
  [0, 0, 0],
];
/** The bars converted with the BT.601 matrix and shown as if BT.709 (what a mislabelled file shows). */
const shownAsBt709: Rgb[] = [
  [255, 255, 255],
  [255, 240, 0],
  [0, 230, 255],
  [0, 216, 0],
  [255, 40, 255],
  [255, 25, 0],
  [0, 15, 255],
  [0, 0, 0],
];

describe('judgeColourBars', () => {
  it('finds every saturated bar where it is drawn and reads its colour', () => {
    const verdict = judgeColourBars(frame(exact), BARS, { minPixels: 100 });
    expect(verdict.problems).toEqual([]);
    expect(verdict.readings.map((reading) => reading.bar)).toEqual([
      '#ffff00',
      '#00ffff',
      '#00ff00',
      '#ff00ff',
      '#ff0000',
      '#0000ff',
    ]);
    expect(verdict.readings[2]).toEqual({
      bar: '#00ff00',
      shown: [0, 255, 0],
      off: 0,
      pixels: 800,
    });
  });

  it('accepts the small error lossy coding leaves', () => {
    const noisy = exact.map(([r, g, b]): Rgb => [Math.abs(r - 3), Math.max(0, g - 4), b]);
    expect(judgeColourBars(frame(noisy), BARS, { minPixels: 100 }).problems).toEqual([]);
  });

  it('names every bar a mislabelled matrix shifts, and by how much', () => {
    const verdict = judgeColourBars(frame(shownAsBt709), BARS, { minPixels: 100 });
    expect(verdict.readings.find((reading) => reading.bar === '#00ff00')).toMatchObject({
      shown: [0, 216, 0],
      off: 39,
    });
    expect(verdict.problems).toEqual([
      '#ffff00 shows as (255, 240, 0), 15 off',
      '#00ffff shows as (0, 230, 255), 25 off',
      '#00ff00 shows as (0, 216, 0), 39 off',
      '#ff00ff shows as (255, 40, 255), 40 off',
      '#ff0000 shows as (255, 25, 0), 25 off',
      '#0000ff shows as (0, 15, 255), 15 off',
    ]);
  });

  it('says so when a bar is missing or too small to read', () => {
    const verdict = judgeColourBars(frame(exact, { barWidth: 2 }), BARS, { minPixels: 100 });
    expect(verdict.readings[0]).toEqual({ bar: '#ffff00', shown: null, off: null, pixels: 40 });
    expect(verdict.problems[0]).toBe('#ffff00 not found (40 pixels near it)');
  });

  it('ignores pixels far from a bar, such as the background and other tiles', () => {
    // A dull red tile (the remote camera) next to the bars must not pull the red bar's reading.
    const colours: Rgb[] = [...exact, [195, 34, 34], [195, 34, 34]];
    const verdict = judgeColourBars(frame(colours), BARS, { minPixels: 100 });
    expect(verdict.readings.find((reading) => reading.bar === '#ff0000')).toMatchObject({
      shown: [255, 0, 0],
      pixels: 800,
    });
  });
});
