import { describe, expect, it, vi } from 'vitest';
import { createFakeMessageChannel } from '@/test/fakes/create-fake-message-channel';
import { createPortNotices } from './create-port-notices';

describe('createPortNotices', () => {
  it('dispatches nowhere while no port is held, and says the event was not cancelled', () => {
    const notices = createPortNotices(() => null, CustomEvent);
    expect(notices.dispatchEvent(new CustomEvent('ns:page:handover'))).toBe(true);
    expect(notices.CustomEvent).toBe(CustomEvent);
  });

  it('puts the listeners added before a port on it once attached, and dispatches there', () => {
    let port: ReturnType<typeof createFakeMessageChannel>['port2'] | null = null;
    const notices = createPortNotices(() => port, CustomEvent);
    const heard = vi.fn();
    notices.addEventListener('ns:bridge:handover', heard);
    const channel = createFakeMessageChannel();
    port = channel.port2;
    notices.attach(channel.port2);
    notices.dispatchEvent(new CustomEvent('ns:bridge:handover'));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('adds a listener to the port it holds at once, and removes it from there', () => {
    const channel = createFakeMessageChannel();
    const notices = createPortNotices(() => channel.port2, CustomEvent);
    const heard = vi.fn();
    notices.addEventListener('ns:page:handover', heard);
    channel.port2.dispatchEvent(new CustomEvent('ns:page:handover'));
    notices.removeEventListener('ns:page:handover', heard);
    channel.port2.dispatchEvent(new CustomEvent('ns:page:handover'));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('takes every listener off a port it lets go of', () => {
    const old = createFakeMessageChannel().port2;
    const notices = createPortNotices(() => null, CustomEvent);
    const heard = vi.fn();
    notices.addEventListener('ns:bridge:handover', heard);
    notices.attach(old);
    notices.detach(old);
    old.dispatchEvent(new CustomEvent('ns:bridge:handover'));
    expect(heard).not.toHaveBeenCalled();
  });
});
