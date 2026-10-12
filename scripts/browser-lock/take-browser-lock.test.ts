import { describe, expect, it } from 'vitest';
import type { LockRecord } from './parse-lock-record';
import { type LockFiles, SILENT_MS, takeBrowserLock } from './take-browser-lock';

const FILE = '/tmp/zen-recorder-browser.lock';
const HOME = '/home/<you>';

const ours: LockRecord = {
  token: 'ours',
  pid: 100,
  command: 'pnpm bench',
  workingCopy: '/home/<you>/b',
  takenAt: 0,
};
const theirs: LockRecord = {
  token: 'theirs',
  pid: 200,
  command: 'pnpm test:e2e',
  workingCopy: '/home/<you>/a',
  takenAt: -60_000,
};

/**
 * An in-memory folder and a clock that `sleep` moves on. `at(ms, act)` runs `act` once the clock
 * reaches `ms`, as another run would act while this one sleeps.
 */
function setup(options: { alive?: (pid: number) => boolean } = {}) {
  let now = 0;
  const stored = new Map<string, { text: string; touchedAtMs: number }>();
  const plans: { at: number; act: () => void }[] = [];
  const lines: string[] = [];
  const files: LockFiles = {
    create: async (file, text) => {
      if (stored.has(file)) return false;
      stored.set(file, { text, touchedAtMs: now });
      return true;
    },
    read: async (file) => stored.get(file) ?? null,
    move: async (from, to) => {
      const found = stored.get(from);
      if (found === undefined) return false;
      stored.delete(from);
      stored.set(to, found);
      return true;
    },
    remove: async (file) => {
      stored.delete(file);
    },
  };
  const put = (record: LockRecord, touchedAtMs = now): void => {
    stored.set(FILE, { text: JSON.stringify(record), touchedAtMs });
  };
  const deps = {
    files,
    isAlive: options.alive ?? (() => true),
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      for (const plan of plans.filter((p) => p.at <= now)) {
        plans.splice(plans.indexOf(plan), 1);
        plan.act();
      }
    },
    log: (line: string) => lines.push(line),
    home: HOME,
  };
  return {
    deps,
    files,
    stored,
    lines,
    put,
    at: (ms: number, act: () => void) => plans.push({ at: ms, act }),
    take: (request: { inheritedToken?: string } = {}) =>
      takeBrowserLock(deps, { file: FILE, record: ours, ...request }),
    holder: () => JSON.parse(stored.get(FILE)?.text ?? 'null'),
    now: () => now,
  };
}

describe('takeBrowserLock', () => {
  it('takes a free lock, writes who holds it, and says nothing', async () => {
    const lock = setup();

    expect(await lock.take()).toBe('taken');

    expect(lock.holder()).toEqual(ours);
    expect(lock.lines).toEqual([]);
  });

  it('waits for the run that holds it, names that run once, reminds every minute and says how long it waited', async () => {
    const lock = setup();
    lock.put(theirs);
    lock.at(150_000, () => lock.stored.delete(FILE));

    expect(await lock.take()).toBe('taken');

    expect(lock.holder()).toEqual(ours);
    expect(lock.lines).toEqual([
      `browser lock: waiting for pnpm test:e2e (pid 200, in ~/a), which has held it for 1 min; one run at a time starts Firefox on this machine (${FILE})`,
      'browser lock: still waiting for pnpm test:e2e (pid 200), 1 min so far',
      'browser lock: still waiting for pnpm test:e2e (pid 200), 2 min so far',
      'browser lock: taken after 2 min 30 s of waiting',
    ]);
  });

  it('names the next holder when another run took the lock first', async () => {
    const lock = setup();
    lock.put(theirs);
    const next = { ...theirs, token: 'next', pid: 300, command: 'pnpm soak', takenAt: 5_000 };
    lock.at(5_000, () => lock.put(next));
    lock.at(8_000, () => lock.stored.delete(FILE));

    await lock.take();

    expect(lock.lines).toEqual([
      expect.stringContaining('waiting for pnpm test:e2e (pid 200'),
      expect.stringContaining('waiting for pnpm soak (pid 300, in ~/a), which has held it for 0 s'),
      'browser lock: taken after 8 s of waiting',
    ]);
  });

  it('keeps waiting for a holder that touches the file, however long it runs', async () => {
    const lock = setup();
    lock.put(theirs);
    for (let at = 30_000; at <= 2 * SILENT_MS; at += 30_000) {
      lock.at(at, () => lock.put(theirs, at));
    }
    lock.at(2 * SILENT_MS + 1_000, () => lock.stored.delete(FILE));

    await lock.take();

    expect(lock.lines.filter((line) => line.includes('taking it over'))).toEqual([]);
    expect(lock.lines.at(-1)).toBe('browser lock: taken after 20 min 1 s of waiting');
  });

  it('takes over at once a lock whose run is gone, and leaves nothing aside', async () => {
    const lock = setup({ alive: (pid) => pid !== theirs.pid });
    lock.put(theirs);

    expect(await lock.take()).toBe('taken');

    expect(lock.holder()).toEqual(ours);
    expect([...lock.stored.keys()]).toEqual([FILE]);
    expect(lock.lines).toEqual([
      'browser lock: pnpm test:e2e (pid 200, in ~/a) ended without releasing it; taking it over',
    ]);
    expect(lock.now()).toBe(0);
  });

  it('takes over a lock nobody touched for ten minutes, though a process has its pid', async () => {
    const lock = setup();
    lock.put(theirs, -SILENT_MS);

    expect(await lock.take()).toBe('taken');

    expect(lock.holder()).toEqual(ours);
    expect(lock.lines).toEqual([
      'browser lock: pnpm test:e2e (pid 200, in ~/a) has not touched it for 10 min (its pid may belong to another program now); taking it over',
    ]);
  });

  it('puts back a lock another run took a moment before this run moved it aside, and waits for it', async () => {
    const lock = setup({ alive: (pid) => pid !== theirs.pid });
    lock.put(theirs);
    const quicker = { ...theirs, token: 'quicker', pid: 300, takenAt: 0 };
    const move = lock.files.move;
    // The other run found the same lock left behind and replaced it first.
    lock.files.move = async (from, to) => {
      lock.put(quicker);
      lock.files.move = move;
      return move(from, to);
    };
    lock.at(3_000, () => lock.stored.delete(FILE));

    await lock.take();

    expect(lock.lines).toEqual([
      expect.stringContaining('waiting for pnpm test:e2e (pid 300'),
      'browser lock: taken after 3 s of waiting',
    ]);
    expect([...lock.stored.keys()]).toEqual([FILE]);
  });

  it('says nothing about a takeover another run made first', async () => {
    const lock = setup({ alive: (pid) => pid !== theirs.pid });
    lock.put(theirs);
    lock.files.move = async () => {
      lock.stored.delete(FILE);
      return false;
    };

    expect(await lock.take()).toBe('taken');

    expect(lock.lines).toEqual([]);
  });

  it('tries again at once when the holder released the lock between its two looks', async () => {
    const lock = setup();
    lock.put(theirs);
    lock.files.read = async () => {
      lock.stored.delete(FILE);
      return null;
    };

    expect(await lock.take()).toBe('taken');

    expect(lock.now()).toBe(0);
    expect(lock.lines).toEqual([]);
  });

  it('goes on without taking it when a parent of the run holds it', async () => {
    const lock = setup();
    lock.put(theirs);

    expect(await lock.take({ inheritedToken: theirs.token })).toBe('inherited');

    expect(lock.holder()).toEqual(theirs);
    expect(lock.lines).toEqual([]);
  });

  it('waits when the token it inherited is not the holder’s', async () => {
    const lock = setup();
    lock.put(theirs);
    lock.at(1_000, () => lock.stored.delete(FILE));

    expect(await lock.take({ inheritedToken: 'an old one' })).toBe('taken');
  });

  it('stops at a file that names no run, as flock leaves one, instead of waiting for ever', async () => {
    const lock = setup();
    lock.stored.set(FILE, { text: '', touchedAtMs: 0 });

    await expect(lock.take()).rejects.toThrow(
      `browser lock: ${FILE} is not a lock file of this project (it names no run). If flock holds it, point ZEN_RECORDER_BROWSER_LOCK at another file; otherwise delete it.`,
    );
  });
});
