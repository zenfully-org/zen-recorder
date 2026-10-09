import type { AudioTap } from '@/lib/page/create-audio-tap';

/**
 * The Diagnostics line that says how the audio tap reads the mix: on its worklet (from a blob URL,
 * or from the extension's file where the page's policy refuses a blob) or a ScriptProcessor.
 */
export function describeTapPath(tap: Pick<AudioTap, 'kind' | 'module'>): string {
  const file = tap.module() === 'file' ? " (the extension's file)" : '';
  return `audio tap: ${tap.kind()}${file}`;
}
