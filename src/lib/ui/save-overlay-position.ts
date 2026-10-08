import { storage } from '#imports';
import type { OverlayPosition, ProviderId } from '@/lib/types';
import { getOverlayPositionKey } from '@/lib/ui/get-overlay-position-key';

/** Remembers where the person left the status card on this service, for its later meetings. */
export async function saveOverlayPosition(
  provider: ProviderId,
  position: OverlayPosition,
): Promise<void> {
  await storage.setItem(getOverlayPositionKey(provider), position);
}
