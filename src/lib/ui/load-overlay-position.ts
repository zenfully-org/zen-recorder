import { storage } from '#imports';
import type { OverlayPosition, ProviderId } from '@/lib/types';
import { getOverlayPositionKey } from '@/lib/ui/get-overlay-position-key';
import { parseOverlayPosition } from '@/lib/ui/parse-overlay-position';

/** Where the person left the status card on this service, or null when it was never moved. */
export async function loadOverlayPosition(provider: ProviderId): Promise<OverlayPosition | null> {
  return parseOverlayPosition(await storage.getItem(getOverlayPositionKey(provider)));
}
