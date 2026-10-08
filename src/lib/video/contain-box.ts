import type { Box } from '@/lib/types';

/**
 * Where content of `width`×`height` sits when it is shown whole inside `box` (CSS
 * `object-fit: contain`): the largest centred box with the content's aspect ratio. A tile read
 * this way is composited without cropping, the way the page shows it.
 */
export function containBox(box: Box, width: number, height: number): Box {
  if (!(width > 0 && height > 0 && box.width > 0 && box.height > 0)) return box;
  // One side always keeps the box's exact size, so no rounding error creeps into it.
  const fitted =
    box.width * height > box.height * width
      ? { width: (box.height * width) / height, height: box.height }
      : { width: box.width, height: (box.width * height) / width };
  return {
    x: box.x + (box.width - fitted.width) / 2,
    y: box.y + (box.height - fitted.height) / 2,
    ...fitted,
  };
}
