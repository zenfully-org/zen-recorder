import sharp from 'sharp';

/**
 * A PNG reduced to a palette of 256 colours, about a fifth of a full-colour screenshot's weight.
 * Dithered at full strength and the highest effort: with less, the soft shadows of the status
 * card and the popup turn into flat blocks.
 */
export async function quantisePng(
  png: Buffer,
): Promise<{ png: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png)
    .png({ palette: true, colours: 256, quality: 100, dither: 1, effort: 10, compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}
