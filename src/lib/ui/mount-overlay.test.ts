import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleCommand, OverlayPosition, TabSnapshot } from '@/lib/types';
import { mountOverlay } from './mount-overlay';

function snapshot(patch: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: 'r',
    recordingStartedAt: 1_000_000 - 65_000,
    remoteTracks: 1,
    micLabel: 'USB mic',
    connected: true,
    admitted: true,
    ...patch,
  };
}

function setup(position: OverlayPosition | null = null) {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const commands: LifecycleCommand[] = [];
  const saved: OverlayPosition[] = [];
  const resizeListeners: (() => void)[] = [];
  const unwatch = vi.fn();
  const handle = mountOverlay(shadow, {
    onCommand: (c) => commands.push(c),
    position,
    onPositionChange: (next) => saved.push(next),
    viewport: () => ({ width: 1280, height: 800 }),
    onViewportResize: (listener) => {
      resizeListeners.push(listener);
      return unwatch;
    },
    now: () => 1_000_000,
    toastMs: 50,
  });
  const get = (selector: string): HTMLElement => {
    const found = shadow.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };
  const card = () => get('.zr-card');
  const toggle = () => get('.zr-toggle');
  const details = () => get('.zr-details');
  const action = (command: LifecycleCommand) => get(`[data-command="${command}"]`);
  const visibleActions = () =>
    [...shadow.querySelectorAll<HTMLButtonElement>('.zr-btn')]
      .filter((b) => !b.hidden)
      .map((b) => b.dataset['command']);
  const key = (target: Element, name: string, type = 'keydown') =>
    target.dispatchEvent(
      new KeyboardEvent(type, { key: name, bubbles: true, composed: true, cancelable: true }),
    );
  return {
    host,
    shadow,
    handle,
    commands,
    saved,
    resizeListeners,
    unwatch,
    get,
    card,
    toggle,
    details,
    action,
    visibleActions,
    key,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('mountOverlay: what the card shows', () => {
  it('is hidden until a snapshot arrives', () => {
    const { handle, card } = setup();
    vi.advanceTimersByTime(1000);
    handle.setEnabled(true);
    expect(card().dataset['visible']).toBeUndefined();
  });

  it.each<{
    label: string;
    snap: TabSnapshot;
    tone: string;
    status: string;
    elapsed: string;
    actions: LifecycleCommand[];
  }>([
    {
      label: 'recording',
      snap: snapshot(),
      tone: 'recording',
      status: 'Recording',
      elapsed: '01:05',
      actions: ['pause', 'stop'],
    },
    {
      label: 'paused',
      snap: snapshot({ state: 'paused' }),
      tone: 'paused',
      status: 'Paused',
      elapsed: '01:05',
      actions: ['resume', 'stop'],
    },
    {
      label: 'stopping',
      snap: snapshot({ state: 'stopping' }),
      tone: 'saving',
      status: 'Saving…',
      elapsed: '',
      actions: [],
    },
    {
      label: 'waiting alone',
      snap: snapshot({ state: 'waiting', remoteTracks: 0, recordingId: null }),
      tone: 'waiting',
      status: 'Waiting for participants',
      elapsed: '',
      actions: ['start'],
    },
  ])('shows $label', ({ snap, tone, status, elapsed, actions }) => {
    const { handle, card, get, visibleActions } = setup();
    handle.update(snap);
    expect(card().dataset['visible']).toBe('true');
    expect(card().dataset['state']).toBe(snap.state);
    expect(card().dataset['tone']).toBe(tone);
    expect(get('.zr-status').textContent).toBe(status);
    expect(get('.zr-time').textContent).toBe(elapsed);
    expect(get('.zr-mic').textContent).toBe('USB mic');
    expect(visibleActions()).toEqual(actions);
  });

  it('shows the video row only while something records', () => {
    const { handle, get } = setup();
    handle.update(snapshot({ videoTiles: 3 }));
    expect(get('.zr-video').textContent).toBe('3 tiles');
    expect(get('.zr-video-row').hidden).toBe(false);
    handle.update(snapshot({ state: 'waiting', recordingId: null }));
    expect(get('.zr-video-row').hidden).toBe(true);
  });

  it('hides the card when there is no meeting route or when disabled', () => {
    const { handle, card } = setup();
    handle.update(snapshot({ meetingCode: null }));
    expect(card().dataset['visible']).toBe('false');
    handle.update(snapshot());
    expect(card().dataset['visible']).toBe('true');
    handle.setEnabled(false);
    expect(card().dataset['visible']).toBe('false');
    handle.setEnabled(true);
    expect(card().dataset['visible']).toBe('true');
  });
});

describe('mountOverlay: a page that holds as much as it may of what the extension has not taken', () => {
  const toasts = (shadow: ShadowRoot) =>
    [...shadow.querySelectorAll<HTMLElement>('.zr-toast')].map((toast) => [
      toast.dataset['kind'],
      toast.getAttribute('role'),
      toast.textContent?.split(',')[0],
    ]);

  it('says so in a few words on the compact card and in full in the details, until it is over', () => {
    const { handle, card, get } = setup();
    handle.update(snapshot({ backlogFull: 'audio-only' }));
    expect(card().dataset['alert']).toBe('audio-only');
    expect(card().dataset['tone']).toBe('recording');
    expect(get('.zr-alert').textContent).toBe('Audio only');
    expect(get('.zr-notice').hidden).toBe(false);
    expect(get('.zr-notice').textContent).toMatch(/^The video stopped: /);
    handle.update(snapshot());
    expect(card().dataset['alert']).toBe('');
    expect(get('.zr-alert').textContent).toBe('');
    expect(get('.zr-notice').hidden).toBe(true);
  });

  it('says that nothing records, rather than "Saving…", while the page waits for the extension', () => {
    const { handle, card, get } = setup();
    handle.update(snapshot({ state: 'stopping', recordingId: null, backlogFull: 'waiting' }));
    expect(card().dataset['tone']).toBe('blocked');
    expect(get('.zr-status').textContent).toBe('Not recording');
    expect(get('.zr-alert').textContent).toBe('Waiting for space');
  });

  it('tells it in a toast each time it gets worse, not at every snapshot, and not when it eases', () => {
    const { handle, shadow } = setup();
    const told = (backlogFull?: 'audio-only' | 'waiting') => {
      handle.update(snapshot(backlogFull ? { backlogFull } : {}));
      return toasts(shadow).map(([, , words]) => words);
    };
    expect(told()).toEqual([]);
    expect(told('audio-only')).toEqual(['Zen Recorder: the video stopped']);
    expect(told('audio-only')).toHaveLength(1);
    expect(told('waiting')).toEqual([
      'Zen Recorder: the video stopped',
      'Zen Recorder: nothing records now',
    ]);
    expect(told('audio-only')).toHaveLength(2);
    expect(told()).toHaveLength(2);
    // Another outage is told again.
    expect(told('audio-only')).toHaveLength(3);
    expect(toasts(shadow).every(([kind, role]) => kind === 'error' && role === 'alert')).toBe(true);
  });

  it('places the card again when the few words change its width', () => {
    const { handle, card, get } = setup({ horizontal: 'left', x: 1200, vertical: 'top', y: 300 });
    Object.defineProperty(card(), 'offsetWidth', { value: 88, configurable: true });
    handle.update(snapshot());
    expect(get('.zr-overlay').style.left).toBe('1184px');
    Object.defineProperty(card(), 'offsetWidth', { value: 180, configurable: true });
    handle.update(snapshot({ backlogFull: 'audio-only' }));
    expect(get('.zr-overlay').style.left).toBe('1092px');
  });
});

describe('mountOverlay: opening the details, and the keyboard', () => {
  it('starts compact, opens the details on a click and closes them on the next', () => {
    const { handle, card, toggle, details } = setup();
    handle.update(snapshot());
    expect(details().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    toggle().click();
    expect(details().hidden).toBe(false);
    expect(card().dataset['expanded']).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().title).toBe('Zen Recorder: hide the details. Drag to move it.');
    toggle().click();
    expect(details().hidden).toBe(true);
    expect(card().dataset['expanded']).toBe('false');
    expect(toggle().title).toBe('Zen Recorder: show the details. Drag to move it.');
  });

  it('closes the details on Escape, keeping the focus on the card for a keyboard user', () => {
    const { handle, shadow, toggle, details, action, key } = setup();
    handle.update(snapshot());
    toggle().click();
    action('pause').focus();
    key(action('pause'), 'Escape');
    expect(details().hidden).toBe(true);
    expect(shadow.activeElement).toBe(toggle());
    toggle().blur();
    toggle().click();
    key(toggle(), 'Escape');
    expect(details().hidden).toBe(true);
    expect(shadow.activeElement).toBeNull();
    key(toggle(), 'Escape');
    expect(details().hidden).toBe(true);
  });

  it('closes the details when told to, as the bridge does on an Escape it caught first', () => {
    const { handle, shadow, toggle, details, action } = setup();
    handle.update(snapshot());
    handle.collapse();
    expect(details().hidden).toBe(true);
    toggle().click();
    action('stop').focus();
    handle.collapse();
    expect(details().hidden).toBe(true);
    expect(shadow.activeElement).toBe(toggle());
  });

  it("keeps keys pressed in the card from the meeting page's shortcuts", () => {
    const { handle, toggle, key, host } = setup();
    const page = vi.fn();
    document.addEventListener('keydown', page);
    document.addEventListener('keyup', page);
    document.addEventListener('keypress', page);
    host.addEventListener('keydown', page);
    handle.update(snapshot());
    for (const type of ['keydown', 'keypress', 'keyup']) key(toggle(), ' ', type);
    key(toggle(), 'Escape');
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener('keydown', page);
    document.removeEventListener('keyup', page);
    document.removeEventListener('keypress', page);
  });

  it('never takes the focus from the meeting page by itself', () => {
    const { handle, shadow, toggle, card } = setup();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    handle.update(snapshot());
    toggle().click();
    handle.toast('saved', 'ok');
    handle.update(snapshot({ state: 'paused' }));
    expect(shadow.activeElement).toBeNull();
    // A mouse press on the card leaves the focus where it was, so the page's shortcuts still work.
    card().dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('moves the focus to the next action when the focused one goes away', () => {
    const { handle, shadow, toggle, action } = setup();
    handle.update(snapshot());
    toggle().click();
    action('pause').focus();
    handle.update(snapshot({ state: 'paused' }));
    expect(shadow.activeElement).toBe(action('resume'));
    handle.update(snapshot({ state: 'stopping' }));
    expect(shadow.activeElement).toBe(toggle());
  });

  it('forwards button clicks as commands without bubbling', () => {
    const { handle, commands, host, action } = setup();
    const outer = vi.fn();
    host.addEventListener('click', outer);
    handle.update(snapshot());
    action('stop').click();
    action('pause').click();
    expect(commands).toEqual(['stop', 'pause']);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('mountOverlay: its place on the page', () => {
  it('moves the card when dragged by a button, presses nothing, and remembers the place', () => {
    const { handle, commands, saved, card, toggle, action, get } = setup();
    handle.update(snapshot());
    toggle().click();
    vi.spyOn(card(), 'getBoundingClientRect').mockReturnValue(new DOMRect(1000, 384, 272, 180));
    const pointer = (type: string, x: number, y: number) =>
      action('stop').dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }),
      );
    pointer('pointerdown', 1100, 500);
    pointer('pointermove', 600, 300);
    expect(get('.zr-overlay').style.transform).toBe('translate(-500px, -200px)');
    pointer('pointerup', 600, 300);
    action('stop').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(commands).toEqual([]);
    expect(saved).toEqual([{ horizontal: 'left', x: 500, vertical: 'top', y: 184 }]);
    expect(get('.zr-overlay').style.left).toBe('500px');
  });

  it('starts where the person left the card on this service', () => {
    const { handle, get } = setup({ horizontal: 'left', x: 30, vertical: 'bottom', y: 60 });
    handle.update(snapshot());
    expect(get('.zr-overlay').style.left).toBe('30px');
    expect(get('.zr-overlay').style.bottom).toBe('60px');
  });

  it('places the card again when the window is resized', () => {
    const { handle, get, resizeListeners, card } = setup({
      horizontal: 'right',
      x: 16,
      vertical: 'top',
      y: 700,
    });
    handle.update(snapshot());
    expect(get('.zr-overlay').style.top).toBe('700px');
    Object.defineProperty(card(), 'offsetHeight', { value: 200, configurable: true });
    for (const listener of resizeListeners) listener();
    expect(get('.zr-overlay').style.top).toBe('592px');
  });
});

describe('mountOverlay: messages, the timer and the end', () => {
  it('shows messages next to the card, read out by screen readers, for a while', () => {
    const { handle, shadow, get } = setup();
    handle.toast('saved', 'ok');
    handle.toast('boom', 'error');
    const toasts = [...shadow.querySelectorAll<HTMLElement>('.zr-toast')];
    expect(toasts.map((t) => [t.textContent, t.dataset['kind'], t.getAttribute('role')])).toEqual([
      ['saved', 'ok', 'status'],
      ['boom', 'error', 'alert'],
    ]);
    expect(toasts.every((toast) => get('.zr-overlay').contains(toast))).toBe(true);
    vi.advanceTimersByTime(50);
    expect(shadow.querySelectorAll('.zr-toast')).toHaveLength(0);
  });

  it('re-renders every second, writing only what changed', () => {
    const { handle, get, shadow } = setup();
    handle.update(snapshot());
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(shadow, { subtree: true, childList: true, characterData: true });
    vi.advanceTimersByTime(3000);
    observer.disconnect();
    expect(get('.zr-time').textContent).toBe('01:05');
    expect(changes).toEqual([]);
  });

  it('destroy removes the DOM, stops the timer and stops watching the window', () => {
    const { handle, shadow, unwatch } = setup();
    handle.destroy();
    expect(shadow.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('works with the default timer functions and clock', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const handle = mountOverlay(shadow, {
      onCommand: () => undefined,
      position: null,
      onPositionChange: () => undefined,
      viewport: () => ({ width: 800, height: 600 }),
      onViewportResize: () => () => undefined,
    });
    handle.update(snapshot({ recordingStartedAt: Date.now() - 2000 }));
    expect(shadow.querySelector('.zr-time')?.textContent).toBe('00:02');
    handle.toast('x', 'ok');
    vi.advanceTimersByTime(8000);
    expect(shadow.querySelectorAll('.zr-toast')).toHaveLength(0);
    handle.destroy();
  });
});
