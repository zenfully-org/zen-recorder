import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';

/**
 * How a recording started, for the notes' summary, in the same words on every service: each one
 * starts on the people the page counts, not on their audio, so a muted joiner starts it too.
 */
export function describeStartCause(cause: string | null): string {
  switch (cause) {
    case 'auto-first-remote':
      return 'automatically once someone else was in the call';
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
