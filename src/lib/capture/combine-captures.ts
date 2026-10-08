import type { MediaCapture } from '@/lib/providers/types';

/**
 * Presents several capture sources as one (say WebRTC plus a Web Audio tap): tracks are merged
 * without duplicates, the page counts as connected when any source is.
 */
export function combineCaptures(captures: MediaCapture[]): MediaCapture {
  return {
    remoteAudioTracks() {
      const byId = new Map(
        captures
          .flatMap((capture) => capture.remoteAudioTracks())
          .map((track) => [track.id, track]),
      );
      return [...byId.values()];
    },
    anyConnected: () => captures.some((capture) => capture.anyConnected()),
    connectionCount: () => captures.reduce((sum, capture) => sum + capture.connectionCount(), 0),
    uninstall() {
      for (const capture of captures) {
        try {
          capture.uninstall();
        } catch {
          // One source failing to restore must not keep the others installed.
        }
      }
    },
  };
}
