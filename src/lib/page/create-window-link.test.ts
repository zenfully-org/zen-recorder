import { describe, expect, it } from 'vitest';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { createWindowLink } from './create-window-link';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('createWindowLink', () => {
  it("posts to the window's own origin and hears what the window posted to itself", async () => {
    const win = createFakeWindow('https://meet.example');
    const heard: unknown[] = [];
    const link = createWindowLink(win);
    link.listen((data) => heard.push(data));
    link.post({ n: 1 });
    await tick();
    expect(win.postedOrigins).toEqual(['https://meet.example']);
    expect(heard).toEqual([{ n: 1 }]);
  });

  it('ignores what a frame posted, and stops hearing once told', () => {
    const win = createFakeWindow();
    const heard: unknown[] = [];
    const stop = createWindowLink(win).listen((data) => heard.push(data));
    win.deliver({ from: 'frame' }, {});
    win.deliver({ from: 'window' }, win);
    stop();
    win.deliver({ from: 'window, later' }, win);
    expect(heard).toEqual([{ from: 'window' }]);
  });

  it('posts nothing and hears nothing while closed', async () => {
    const win = createFakeWindow();
    let open = false;
    const heard: unknown[] = [];
    const link = createWindowLink(win, () => open);
    link.listen((data) => heard.push(data));
    link.post({ n: 1 });
    win.deliver({ n: 2 }, win);
    await tick();
    expect(win.postedOrigins).toEqual([]);
    expect(heard).toEqual([]);
    open = true;
    win.deliver({ n: 3 }, win);
    expect(heard).toEqual([{ n: 3 }]);
  });
});
