import { describe, expect, it, vi } from 'vitest';
import { getAddOnId } from '@/lib/get-add-on-id';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import {
  createFakeMessageChannel,
  type FakeMessageChannel,
} from '@/test/fakes/create-fake-message-channel';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { connectToPage } from './connect-to-page';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('connectToPage', () => {
  it('pairs with the recorder of this build and talks to it over the port only', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win);
    const { messenger } = connectToPage(win, {
      createChannel: createFakeMessageChannel,
      pageWindow: win,
    });
    const configured = vi.fn();
    page.onMessage('bridge:configure', configured);
    messenger.notify('bridge:configure', parsePageConfig({}));
    await tick();
    expect(configured).toHaveBeenCalledTimes(1);
    expect(win.postedOrigins).toEqual([]);
  });

  it('talks over the window, and dispatches no connect, when a page session of an earlier build owns the page', async () => {
    const win = createFakeWindow();
    Object.defineProperty(win, Symbol.for('zen-recorder.page-session'), { value: {} });
    const connects = vi.fn();
    win.addEventListener(`${getAddOnId()}:connect`, connects);
    const { messenger } = connectToPage(win, {
      createChannel: createFakeMessageChannel,
      pageWindow: win,
    });
    messenger.notify('bridge:configure', parsePageConfig({}));
    await tick();
    expect(connects).not.toHaveBeenCalled();
    expect(win.postedOrigins).toHaveLength(1);
  });

  it('closes its port and stops hearing once disposed', () => {
    const win = createFakeWindow();
    createPageMessenger(win);
    const made: FakeMessageChannel[] = [];
    const connection = connectToPage(win, {
      createChannel: () => {
        const channel = createFakeMessageChannel();
        made.push(channel);
        return channel;
      },
      pageWindow: win,
    });
    connection.dispose();
    expect(made[0]?.port1.isClosed()).toBe(true);
    expect(win.listeners.get('message')?.size ?? 0).toBe(0);
  });
});
