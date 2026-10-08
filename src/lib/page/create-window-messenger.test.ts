import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFakeWindow, type FakeWindow } from '@/test/fakes/create-fake-window';
import { createWindowMessenger, type WindowMessengerOptions } from './create-window-messenger';

interface Protocol extends Record<string, (data: never) => unknown> {
  add: (data: { a: number; b: number }) => number;
  fail: (data: undefined) => void;
  failWeird: (data: undefined) => void;
  blob: (data: Blob) => number;
  slow: (data: undefined) => string;
}

const addSchema = z.object({ a: z.number(), b: z.number() });

/** A messenger on the fake window. */
function on(win: FakeWindow, options?: WindowMessengerOptions) {
  return createWindowMessenger<Protocol>('ns', win as unknown as Window, options);
}

function pair() {
  const win = createFakeWindow();
  return { win, a: on(win), b: on(win) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('createWindowMessenger', () => {
  it('delivers a request to the other side and resolves with its response, same-origin only', async () => {
    const { win, a, b } = pair();
    b.onMessage('add', ({ data }) => {
      const { a: left, b: right } = addSchema.parse(data);
      return left + right;
    });
    await expect(a.sendMessage('add', { a: 2, b: 3 })).resolves.toBe(5);
    expect(win.postedOrigins).toEqual(['http://localhost', 'http://localhost']);
  });

  it('rejects when the handler throws (Error or not)', async () => {
    const { a, b } = pair();
    b.onMessage('fail', () => {
      throw new Error('nope');
    });
    b.onMessage('failWeird', () => {
      throw 'weird';
    });
    await expect(a.sendMessage('fail', undefined)).rejects.toThrow('nope');
    await expect(a.sendMessage('failWeird', undefined)).rejects.toThrow('weird');
  });

  it('passes Blobs and supports async handlers', async () => {
    const { a, b } = pair();
    b.onMessage('blob', async ({ data }) => z.instanceof(Blob).parse(data).size);
    b.onMessage('slow', () => new Promise((r) => setTimeout(() => r('done'), 5)));
    await expect(a.sendMessage('blob', new Blob(['abcd']))).resolves.toBe(4);
    await expect(a.sendMessage('slow', undefined)).resolves.toBe('done');
  });

  it('ignores foreign messages, other namespaces, unknown types and stale responses', async () => {
    const { win, a } = pair();
    const handler = vi.fn(() => 1);
    a.onMessage('add', handler);
    win.deliver('string', win);
    win.deliver(null, win);
    win.deliver({ ns: 'other', kind: 'req', id: 'x:1', type: 'add', data: {} }, win);
    win.deliver({ ns: 'ns', kind: 'req', id: 'x:1', type: 'unknown', data: {} }, win);
    win.deliver({ ns: 'ns', kind: 'req', id: 'x:1', type: 7, data: {} }, win);
    win.deliver({ ns: 'ns', kind: 'res', id: 'x:99', ok: true }, win);
    win.deliver({ ns: 'ns', kind: 'req', id: 42, type: 'add' }, win);
    win.deliver({ ns: 'ns', kind: 'req', id: 'x:1', type: 'add', data: {} }, { other: true });
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(win.postedOrigins).toEqual([]);
  });

  it('does not answer its own requests when no other side listens', async () => {
    const win = createFakeWindow();
    const a = on(win);
    const handler = vi.fn(() => 1);
    a.onMessage('add', handler);
    a.notify('add', { a: 1, b: 1 });
    await tick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses a generic error message when the response carries none', async () => {
    const { win, a } = pair();
    const promise = a.sendMessage('add', { a: 1, b: 1 }).catch(() => undefined);
    await tick();
    const id = `${[...win.listeners].length > 0 ? '' : ''}`;
    expect(id).toBe('');
    // Reply to whatever request id was posted with a failure lacking an error string.
    const listener = (event: MessageEvent) => {
      const env = event.data as { kind?: string; id?: string };
      if (env.kind === 'req' && env.id)
        win.deliver({ ns: 'ns', kind: 'res', id: env.id, ok: false }, win);
    };
    win.addEventListener('message', listener);
    const again = a.sendMessage('add', { a: 1, b: 1 });
    await expect(again).rejects.toThrow('request failed');
    win.removeEventListener('message', listener);
    void promise;
  });

  it('accepts the envelopes of an older session (no data or error keys)', async () => {
    const { win, a } = pair();
    const handler = vi.fn(() => 7);
    a.onMessage('add', handler);
    win.deliver({ ns: 'ns', kind: 'req', id: 'old:1', type: 'add' }, win);
    await tick();
    expect(handler).toHaveBeenCalledWith({ data: undefined });

    const listener = (event: MessageEvent) => {
      const env = z.object({ kind: z.string(), id: z.string() }).parse(event.data);
      if (env.kind === 'req') win.deliver({ ns: 'ns', kind: 'res', id: env.id, ok: true }, win);
    };
    win.addEventListener('message', listener);
    await expect(a.sendMessage('add', { a: 1, b: 1 })).resolves.toBeUndefined();
    win.removeEventListener('message', listener);
  });

  it('unregisters handlers and rejects when postMessage throws', async () => {
    const { win, a, b } = pair();
    const off = b.onMessage('add', () => 1);
    off();
    off();
    const replaced = b.onMessage('add', () => 2);
    b.onMessage('add', () => 3);
    replaced();
    await expect(a.sendMessage('add', { a: 0, b: 0 })).resolves.toBe(3);
    win.failNextPost(new Error('DataCloneError'));
    await expect(a.sendMessage('add', { a: 1, b: 1 })).rejects.toThrow('DataCloneError');
    win.failNextPost('string error');
    await expect(a.sendMessage('add', { a: 1, b: 1 })).rejects.toThrow('string error');
  });

  it('gives up on a request without an answer after the timeout, and ignores a late answer', async () => {
    vi.useFakeTimers();
    try {
      const win = createFakeWindow();
      const a = on(win, { timeoutMs: 100 });
      const ids: string[] = [];
      win.addEventListener('message', (event) => {
        const env = z.object({ kind: z.string(), id: z.string() }).safeParse(event.data);
        if (env.success && env.data.kind === 'req') ids.push(env.data.id);
      });
      const request = a.sendMessage('add', { a: 1, b: 1 });
      const outcome = request.then(
        () => 'answered',
        (error: unknown) => String(error),
      );
      await vi.advanceTimersByTimeAsync(99);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toBe('Error: no answer to add within 100 ms');
      // The answer that comes after all is dropped, and nothing is left waiting.
      win.deliver({ ns: 'ns', kind: 'res', id: ids[0], ok: true, data: 2 }, win);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits 30 s for an answer by default, and clears the wait once answered', async () => {
    vi.useFakeTimers();
    try {
      const { a, b } = pair();
      b.onMessage('add', () => 1);
      const answered = a.sendMessage('add', { a: 0, b: 1 });
      await vi.advanceTimersByTimeAsync(5);
      await expect(answered).resolves.toBe(1);
      expect(vi.getTimerCount()).toBe(0);

      const win = createFakeWindow();
      const lonely = on(win);
      const outcome = lonely.sendMessage('add', { a: 1, b: 1 }).catch(String);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toBe('Error: no answer to add within 30000 ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies the other side without waiting for its answer', async () => {
    vi.useFakeTimers();
    try {
      const { win, a, b } = pair();
      const handler = vi.fn(() => 1);
      b.onMessage('add', handler);
      a.notify('add', { a: 1, b: 2 });
      await vi.advanceTimersByTimeAsync(5);
      expect(handler).toHaveBeenCalledWith({ data: { a: 1, b: 2 } });
      // The answer was posted and dropped; nothing waits for one.
      expect(win.postedOrigins).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
      // A notice nobody receives leaves nothing behind either.
      b.dispose();
      a.notify('add', { a: 1, b: 2 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws from notify when the data cannot be posted', () => {
    const { win, a } = pair();
    win.failNextPost(new Error('DataCloneError'));
    expect(() => a.notify('add', { a: 1, b: 1 })).toThrow('DataCloneError');
  });

  it('rejects the requests still waiting when disposed, and keeps no timer', async () => {
    vi.useFakeTimers();
    try {
      const win = createFakeWindow();
      const a = on(win);
      const outcome = a.sendMessage('add', { a: 1, b: 1 }).catch(String);
      // Delivered, and nobody answers.
      await vi.advanceTimersByTimeAsync(1);
      a.dispose();
      await expect(outcome).resolves.toBe('Error: the messenger was disposed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops listening after dispose', async () => {
    const { win, a, b } = pair();
    const handler = vi.fn(() => 1);
    b.onMessage('add', handler);
    b.dispose();
    a.notify('add', { a: 1, b: 1 });
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(win.listeners.size).toBe(1);
  });
});
