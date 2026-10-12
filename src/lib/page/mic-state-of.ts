import type { MicState } from '@/lib/types';

/**
 * The user's microphone as the recording hears it: the mirror's clone on or off (it follows the
 * page's mute, `createMicMirror`), or no microphone the page holds open.
 */
export function micStateOf(mirror: { clone: { enabled: boolean } } | null): MicState {
  if (!mirror) return 'not-connected';
  return mirror.clone.enabled ? 'live' : 'muted';
}
