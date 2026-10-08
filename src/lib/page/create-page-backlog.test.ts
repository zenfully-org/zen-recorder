import { describe, expect, it } from 'vitest';
import { createPageBacklog } from './create-page-backlog';

/** A sender whose unacked bytes the test sets, and which settles when the test says so. */
function fakeSender(bytes: number) {
  let resolveIdle = (): void => undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  const sender = {
    bytes,
    done: false,
    pendingBytes: () => sender.bytes,
    whenIdle: () => idle,
    settled: () => sender.done,
    /** The extension took every chunk and the end. */
    drain: () => {
      sender.bytes = 0;
      sender.done = true;
      resolveIdle();
    },
  };
  return sender;
}

describe('createPageBacklog', () => {
  it('holds nothing before a recording stops, and reads its limit each time it is asked', () => {
    let limit = 25;
    const backlog = createPageBacklog(() => limit);
    expect(backlog.stoppedBytes(true)).toBe(0);
    expect(backlog.stoppedBytes(false)).toBe(0);
    expect(backlog.pendingIds()).toEqual([]);
    limit = 10;
    expect(backlog.limitBytes()).toBe(10);
  });

  it('counts what the stopped recordings still hold, apart for those with video and those without', () => {
    const backlog = createPageBacklog(() => 25);
    const video = fakeSender(300);
    const audio = fakeSender(20);
    backlog.add('v1', video, true);
    backlog.add('a1', audio, false);
    backlog.add('a2', fakeSender(5), false);
    expect(backlog.stoppedBytes(true)).toBe(300);
    expect(backlog.stoppedBytes(false)).toBe(25);
    // What the extension takes stops counting at once.
    video.bytes = 100;
    expect(backlog.stoppedBytes(true)).toBe(100);
  });

  it('claims a stopped recording until the background has its end, then forgets it', () => {
    const backlog = createPageBacklog(() => 25);
    const first = fakeSender(10);
    // Every chunk taken, the end still on its way: still the page's to deliver.
    const ending = fakeSender(0);
    backlog.add('r1', first, false);
    backlog.add('r2', ending, false);
    expect(backlog.pendingIds()).toEqual(['r1', 'r2']);
    first.drain();
    expect(backlog.pendingIds()).toEqual(['r2']);
    backlog.add('r3', fakeSender(7), true);
    // The settled one is gone for good: it would never hold anything again.
    first.bytes = 99;
    expect(backlog.stoppedBytes(false)).toBe(0);
    expect(backlog.pendingIds()).toEqual(['r2', 'r3']);
  });

  it('makes room at once while the stopped recordings of that kind hold no more than the limit', async () => {
    const backlog = createPageBacklog(() => 25);
    backlog.add('a1', fakeSender(25), false);
    backlog.add('v1', fakeSender(300), true);
    await expect(backlog.whenRoom(false)).resolves.toBeUndefined();
  });

  it('makes room once the extension took every stopped recording of a kind over the limit, whatever the other kind still holds', async () => {
    const backlog = createPageBacklog(() => 25);
    const first = fakeSender(10);
    const second = fakeSender(20);
    const video = fakeSender(300);
    backlog.add('a1', first, false);
    backlog.add('a2', second, false);
    backlog.add('v1', video, true);
    let room = false;
    void backlog.whenRoom(false).then(() => {
      room = true;
    });
    first.drain();
    await Promise.resolve();
    // Below the limit again is not enough: the next recording would fill it at its next chunk.
    expect(room).toBe(false);
    second.drain();
    await expect.poll(() => room).toBe(true);
    expect(backlog.stoppedBytes(true)).toBe(300);
  });
});
