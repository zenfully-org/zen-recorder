// @vitest-environment node
import sharp from 'sharp';
import { quantisePng } from './quantise-png';

const WIDTH = 160;
const HEIGHT = 100;

/** A picture with thousands of colours: a gradient in red and green, blue fixed. */
async function gradient(): Promise<Buffer> {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const at = (y * WIDTH + x) * 3;
      pixels[at] = Math.round((x * 255) / (WIDTH - 1));
      pixels[at + 1] = Math.round((y * 255) / (HEIGHT - 1));
      pixels[at + 2] = 128;
    }
  }
  return sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toBuffer();
}

/** The mean difference of two pictures of the same size, per channel, 0 to 255. */
async function meanDifference(a: Buffer, b: Buffer): Promise<number> {
  const [pixelsA, pixelsB] = await Promise.all(
    [a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer()),
  );
  if (!pixelsA || !pixelsB) throw new Error('no pixels');
  let total = 0;
  for (let i = 0; i < pixelsA.length; i++) total += Math.abs((pixelsA[i] ?? 0) - (pixelsB[i] ?? 0));
  return total / pixelsA.length;
}

describe('quantisePng', () => {
  it('writes a palette PNG of the same size that looks the same and weighs less', async () => {
    const original = await gradient();

    const { png, width, height } = await quantisePng(original);

    expect({ width, height }).toEqual({ width: WIDTH, height: HEIGHT });
    const metadata = await sharp(png).metadata();
    expect(metadata).toMatchObject({
      format: 'png',
      isPalette: true,
      width: WIDTH,
      height: HEIGHT,
    });
    expect(png.length).toBeLessThan(original.length);
    // Dithering puts each pixel a few levels off (about 3 of 255 here), never the picture.
    expect(await meanDifference(original, png)).toBeLessThan(8);
  });
});
