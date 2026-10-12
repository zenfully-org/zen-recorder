/** AMO shows a listing's screenshots at 1280 by 800 pixels. */
const WIDTH = 1280;
const HEIGHT = 800;
/** Small enough to load at once on the listing, and to keep the repository light. */
const MAX_BYTES = 100_000;

/** What a store screenshot gets wrong, if anything: empty when it fits the listing. */
export function judgeStoreScreenshot(picture: {
  width: number;
  height: number;
  bytes: number;
}): string[] {
  const { width, height, bytes } = picture;
  return [
    ...(width === WIDTH && height === HEIGHT
      ? []
      : [`is ${width} by ${height} pixels, not ${WIDTH} by ${HEIGHT}`]),
    ...(bytes < MAX_BYTES ? [] : [`weighs ${bytes} bytes, not under ${MAX_BYTES / 1000} kB`]),
  ];
}
