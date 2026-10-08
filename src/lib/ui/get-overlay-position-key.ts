import type { ProviderId } from '@/lib/types';

/**
 * The local storage key of the status card's position on one service. Each service keeps its own:
 * their controls sit in different places, so a good spot on one can cover a button on another.
 */
export function getOverlayPositionKey(provider: ProviderId): `local:overlayPosition:${ProviderId}` {
  return `local:overlayPosition:${provider}`;
}
