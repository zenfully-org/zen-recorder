import { createNotesTracker, type NotesTracker } from '@/lib/page/create-notes-tracker';
import type { PageMessenger } from '@/lib/page/create-page-messenger';
import type { MeetingLocation, MeetingProvider } from '@/lib/providers/types';

/**
 * The meeting notes of a meeting page's recordings (`createNotesTracker`): their events go to the
 * bridge, and who is in the call is what the provider reads on the page as it is at that moment.
 */
export function createPageNotes(deps: {
  win: Pick<Window, 'setTimeout' | 'document'>;
  messenger: Pick<PageMessenger, 'sendMessage'>;
  provider: Pick<MeetingProvider, 'readPresence' | 'notesCapabilities'>;
  readLocation: () => MeetingLocation;
}): NotesTracker {
  const { win, messenger, provider } = deps;
  return createNotesTracker({
    send: (batch) => messenger.sendMessage('page:events', batch),
    now: () => Date.now(),
    setTimeout: (handler, ms) => win.setTimeout(handler, ms),
    presence: {
      read: () => provider.readPresence({ location: deps.readLocation(), document: win.document }),
      capabilities: provider.notesCapabilities,
    },
  });
}
