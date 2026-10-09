import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsEntry } from '@/lib/types';
import { createDiagnosticsLog } from './create-diagnostics-log';

function setup(options: { stored?: unknown; max?: number; loadFails?: boolean } = {}) {
  let stored: unknown = options.stored;
  const saves: DiagnosticsEntry[][] = [];
  let time = 100;
  const log = createDiagnosticsLog({
    load: async () => {
      if (options.loadFails) throw new Error('storage gone');
      return stored;
    },
    save: async (entries) => {
      stored = entries;
      saves.push(entries);
    },
    now: () => time++,
    ...(options.max ? { max: options.max } : {}),
  });
  return { log, saves, stored: () => stored };
}

describe('createDiagnosticsLog', () => {
  it('appends timestamped entries in order and persists after each one', async () => {
    const { log, saves } = setup();
    log.append({ level: 'info', source: 'page', message: 'started' });
    log.append({ level: 'error', source: 'background', message: 'boom' });
    await log.flush();
    expect(await log.list()).toEqual([
      { at: 100, level: 'info', source: 'page', message: 'started' },
      { at: 101, level: 'error', source: 'background', message: 'boom' },
    ]);
    expect(saves).toHaveLength(2);
  });

  it('continues a persisted log and ignores malformed storage', async () => {
    const previous = [{ at: 1, level: 'warn', source: 'bridge', message: 'old' }];
    const { log } = setup({ stored: previous });
    log.append({ level: 'info', source: 'page', message: 'new' });
    expect((await log.list()).map((e) => e.message)).toEqual(['old', 'new']);
    const bad = setup({ stored: 'garbage' });
    expect(await bad.log.list()).toEqual([]);
    const failing = setup({ loadFails: true });
    expect(await failing.log.list()).toEqual([]);
  });

  // A page's line sent again after the Port came back: written at the time the bridge got it.
  it('keeps the time an entry comes with, and the entries in time order', async () => {
    const { log } = setup();
    log.append({ level: 'info', source: 'background', message: 'saved' });
    log.append({ level: 'info', source: 'page:3', message: 'ended', at: 50 });
    log.append({ level: 'info', source: 'page:3', message: 'same time', at: 50 });
    expect((await log.list()).map((e) => [e.at, e.message])).toEqual([
      [50, 'ended'],
      [50, 'same time'],
      [100, 'saved'],
    ]);
  });

  it('caps the buffer at max entries, dropping the oldest', async () => {
    const { log } = setup({ max: 2 });
    for (const message of ['a', 'b', 'c']) log.append({ level: 'info', source: 'page', message });
    expect((await log.list()).map((e) => e.message)).toEqual(['b', 'c']);
  });

  it('clear empties the log and the storage; listing returns copies', async () => {
    const { log, stored } = setup();
    log.append({ level: 'info', source: 'page', message: 'x' });
    const listed = await log.list();
    listed.push({ at: 0, level: 'info', source: 'x', message: 'mutated' });
    expect(await log.list()).toHaveLength(1);
    await log.clear();
    expect(await log.list()).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('keeps working after a failing save', async () => {
    let fail = true;
    const log = createDiagnosticsLog({
      load: async () => [],
      save: async () => {
        if (fail) throw new Error('quota');
      },
    });
    log.append({ level: 'info', source: 'page', message: 'first' });
    await log.flush();
    fail = false;
    log.append({ level: 'info', source: 'page', message: 'second' });
    expect((await log.list()).map((e) => e.message)).toEqual(['first', 'second']);
    expect(vi.isMockFunction(log.append)).toBe(false);
  });
});
