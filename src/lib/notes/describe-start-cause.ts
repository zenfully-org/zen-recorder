import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';

/**
 * How a recording started, for the notes' summary. Worded per service where they differ: Meet
 * starts on the first remote audio track, Zoom and Teams on the participant count.
 */
export function describeStartCause(cause: string | null, service: string): string {
  switch (cause) {
    case 'auto-first-remote':
      return service === 'meet'
        ? "automatically when another participant's audio arrived"
        : 'automatically when another participant joined';
    case 'auto-on-join':
      return 'automatically when you joined the call';
    case 'manual':
      return 'when you pressed Record';
    case 'restart-after-video-failure':
      return 'automatically, after the video failed in the previous file';
    case null:
      return 'not known';
    default:
      return escapeMarkdownInline(cause);
  }
}
