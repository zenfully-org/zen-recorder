import { z } from 'zod';
import type { OverlayPosition } from '@/lib/types';

const distance = z.number().finite().min(0);

const overlayPositionSchema = z.object({
  horizontal: z.enum(['left', 'right']),
  x: distance,
  vertical: z.enum(['top', 'bottom']),
  y: distance,
});

/** Reads a stored status card position; anything else (nothing stored, an old shape) is null. */
export function parseOverlayPosition(input: unknown): OverlayPosition | null {
  const result = overlayPositionSchema.safeParse(input);
  return result.success ? result.data : null;
}
