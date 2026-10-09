/**
 * How many people the meeting has besides the user, as the tab's snapshot says. The page sends
 * the count its lifecycle uses (`others`): a provider that counts participants decides it, since
 * Zoom plays everyone's audio through one element and Teams mixes it into one track, so a remote
 * audio track does not mean someone is there. A page session older than that count only sends
 * its remote audio tracks.
 */
import type { TabSnapshot } from '@/lib/types';

export function countOthers(snapshot: Pick<TabSnapshot, 'others' | 'remoteTracks'>): number {
  return snapshot.others ?? snapshot.remoteTracks;
}
