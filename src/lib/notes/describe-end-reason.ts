import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';

const REASONS: Readonly<Record<string, string>> = {
  command: 'you pressed Stop',
  'left-meeting': 'you left the meeting',
  pagehide: 'the meeting tab closed or went to another page',
  'connections-lost': 'the call disconnected (you left, the meeting ended, or the network dropped)',
  'encoder-error': 'the recording failed (an encoder error); it may go on in another file',
  'backlog-full':
    'the meeting page held as much as it could of what could not be saved yet; it goes on in another file',
  recovered: 'the meeting tab closed, or Firefox or the extension stopped, while recording',
};

/** Why a recording ended, for the notes' summary and the stop row of the timeline. */
export function describeEndReason(reason: string | null): string {
  if (reason === null) return 'not known';
  return REASONS[reason] ?? escapeMarkdownInline(reason);
}
