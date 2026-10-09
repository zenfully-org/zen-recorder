import { connectToPage } from '@/lib/bridge/connect-to-page';
import type { PageMessenger } from '@/lib/page/create-page-messenger';
import { createFakeMessageChannel } from '@/test/fakes/create-fake-message-channel';

/**
 * The bridge's side of the page ↔ bridge channel, wired as `runBridge` wires it (`connectToPage`),
 * over a fake `MessageChannel`: the tests of the page session and of the bridge talk through it.
 * Made before the page's messenger, it pairs once the recorder announces itself; after, at once.
 */
export function connectTestBridge<T>(win: Parameters<typeof connectToPage<T>>[0]): PageMessenger {
  return connectToPage(win, { createChannel: createFakeMessageChannel, pageWindow: win }).messenger;
}
