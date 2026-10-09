/**
 * Compares a decoded video frame with the colour bars a fixture page painted
 * (`FixtureApi.showColourBars`), wherever the compositor placed and scaled them.
 *
 * Only the saturated bars count: grey looks the same whichever matrix a player picks, and the
 * frame's background, labels and other tiles sit near white and black. For each saturated bar, the
 * pixels within `RADIUS` of its colour on every channel are taken as the bar, and their median on
 * each channel is the colour the file shows for it. A player that decodes with the matrix the
 * encoder used shows each bar within a few levels (lossy coding); one told the wrong matrix
 * (BT.709 for BT.601) moves full-strength colours by 15 to 40 levels.
 */

/** A frame as rows of RGB bytes (`ffmpeg -pix_fmt rgb24`). */
export interface RgbFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
}

interface BarReading {
  /** The bar's colour, `#rrggbb`. */
  bar: string;
  /** The colour the frame shows for it; null when too few pixels came near it. */
  shown: [number, number, number] | null;
  /** The largest difference between `shown` and the bar on one channel. */
  off: number | null;
  /** Pixels taken as the bar. */
  pixels: number;
}

export interface ColourBarsVerdict {
  readings: BarReading[];
  problems: string[];
}

/** How far a pixel may be from a bar's colour, on every channel, to count as part of it. */
const RADIUS = 48;
/** The most a bar may be off once decoded: lossy coding and rounding stay well below it. */
const TOLERANCE = 8;
/** Fewer pixels than this near a bar means it is not in the frame. */
const MIN_PIXELS = 500;

function parseColour(bar: string): [number, number, number] {
  const channel = (at: number) => Number.parseInt(bar.slice(at, at + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** Grey bars (white, black) read the same under any matrix: they prove nothing here. */
function isSaturated([r, g, b]: readonly number[]): boolean {
  return !(r === g && g === b);
}

function median(histogram: Uint32Array, count: number): number {
  let seen = 0;
  for (let value = 0; value < histogram.length; value++) {
    seen += histogram[value] ?? 0;
    if (seen * 2 >= count) return value;
  }
  return histogram.length - 1;
}

function readBar(frame: RgbFrame, bar: string, minPixels: number): BarReading {
  const target = parseColour(bar);
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let pixels = 0;
  for (let at = 0; at + 2 < frame.rgb.length; at += 3) {
    const pixel = [frame.rgb[at] ?? 0, frame.rgb[at + 1] ?? 0, frame.rgb[at + 2] ?? 0];
    if (pixel.some((value, channel) => Math.abs(value - (target[channel] ?? 0)) > RADIUS)) continue;
    pixels++;
    pixel.forEach((value, channel) => {
      const histogram = histograms[channel];
      if (histogram) histogram[value] = (histogram[value] ?? 0) + 1;
    });
  }
  if (pixels < minPixels) return { bar, shown: null, off: null, pixels };
  const [r, g, b] = histograms.map((histogram) => median(histogram, pixels));
  const shown: [number, number, number] = [r ?? 0, g ?? 0, b ?? 0];
  const off = Math.max(...shown.map((value, channel) => Math.abs(value - (target[channel] ?? 0))));
  return { bar, shown, off, pixels };
}

function describe(reading: BarReading): string | null {
  if (reading.shown === null) return `${reading.bar} not found (${reading.pixels} pixels near it)`;
  if ((reading.off ?? 0) <= TOLERANCE) return null;
  return `${reading.bar} shows as (${reading.shown.join(', ')}), ${reading.off} off`;
}

export function judgeColourBars(
  frame: RgbFrame,
  bars: readonly string[],
  options: { minPixels?: number } = {},
): ColourBarsVerdict {
  const readings = bars
    .filter((bar) => isSaturated(parseColour(bar)))
    .map((bar) => readBar(frame, bar, options.minPixels ?? MIN_PIXELS));
  const problems = readings.flatMap((reading) => describe(reading) ?? []);
  return { readings, problems };
}
