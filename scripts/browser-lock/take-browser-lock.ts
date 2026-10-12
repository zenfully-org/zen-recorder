/**
 * Takes the browser lock, waiting while another run holds it. The lock is a file that exists
 * while a run holds it and names that run (`LockRecord`). A run creates it, and only one can: the
 * file is created complete or not at all (`LockFiles.create`). A holder releases the lock by
 * deleting the file, and touches it while it runs, so a waiting run can tell a lock left behind
 * from one in use:
 *   - its process is gone (a run killed before it could delete the file): taken over at once;
 *   - its process exists but has not touched the file for `silentMs`: the holder's pid now belongs
 *     to another program (the system reused it), or the holder is frozen: taken over too.
 * Taking over moves the file aside before deleting it, so that of two runs that find the same
 * lock left behind only one removes it; one that moved a lock taken a moment ago puts it back.
 *
 * A run started by the holder (a command `pnpm browser-lock` runs, or a second call in the same
 * process) passes the holder's token as `inheritedToken` and goes on without taking it again.
 * A file that holds no record is not this project's lock (an empty file `flock` created and may
 * hold): waiting for it could wait for ever, so the run stops and says so.
 */
import { describeLockNotice, type LockNotice } from './describe-lock-notice';
import { type LockRecord, parseLockRecord } from './parse-lock-record';

export interface LockFiles {
  /** Creates `file` with `text` unless it exists: false when it does. Never a partial file. */
  create(file: string, text: string): Promise<boolean>;
  /** The file's text and when it was last touched, or null when it does not exist. */
  read(file: string): Promise<{ text: string; touchedAtMs: number } | null>;
  /** Renames `from` to `to`: false when `from` does not exist. */
  move(from: string, to: string): Promise<boolean>;
  /** Deletes the file if it exists. */
  remove(file: string): Promise<void>;
}

export interface BrowserLockDeps {
  files: LockFiles;
  /** Whether a process with this pid exists. */
  isAlive(pid: number): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** The home folder, which the lines shorten to `~`. */
  home: string;
}

export interface BrowserLockRequest {
  file: string;
  /** What this run writes into the file. */
  record: LockRecord;
  /** The token of the lock a parent of this run holds, if one does. */
  inheritedToken?: string | undefined;
  pollMs?: number;
  reminderMs?: number;
  silentMs?: number;
}

const POLL_MS = 1_000;
const REMINDER_MS = 60_000;
/**
 * A holder touches the file every 30 s, from its event loop, which a synchronous step blocks:
 * the e2e run builds the previous release with `execFileSync` (an install and a build) and reads
 * the saved files with ffmpeg the same way. Ten minutes are well above either.
 */
export const SILENT_MS = 10 * 60_000;

/** `taken`: this run holds the lock now; `inherited`: a parent of this run holds it. */
export async function takeBrowserLock(
  deps: BrowserLockDeps,
  request: BrowserLockRequest,
): Promise<'taken' | 'inherited'> {
  const { file, record } = request;
  const say = (notice: LockNotice): void => deps.log(describeLockNotice(notice, deps.home));
  const waiting = createWaitingLines(deps.now, say, request.reminderMs ?? REMINDER_MS);
  while (!(await deps.files.create(file, JSON.stringify(record)))) {
    const found = await deps.files.read(file);
    // Released between the two calls: try again at once.
    if (found === null) continue;
    const look = judgeLock(deps, request, found);
    if (look.kind === 'inherited') return 'inherited';
    if (look.kind === 'left') {
      if (await takeOver(deps.files, file, `${file}.${record.token}.stale`, found.text)) {
        say({ kind: 'taken-over', holder: look.holder, why: look.why, silentMs: look.silentMs });
      }
      continue;
    }
    waiting.heldBy(look.holder, file);
    await deps.sleep(request.pollMs ?? POLL_MS);
  }
  waiting.taken();
  return 'taken';
}

type Look =
  | { kind: 'inherited' }
  | { kind: 'held'; holder: LockRecord }
  | { kind: 'left'; holder: LockRecord; why: 'ended' | 'silent'; silentMs: number };

function judgeLock(
  deps: BrowserLockDeps,
  request: BrowserLockRequest,
  found: { text: string; touchedAtMs: number },
): Look {
  const holder = parseLockRecord(found.text);
  if (holder === null) {
    throw new Error(
      `browser lock: ${request.file} is not a lock file of this project (it names no run). If flock holds it, point ZEN_RECORDER_BROWSER_LOCK at another file; otherwise delete it.`,
    );
  }
  if (holder.token === request.inheritedToken) return { kind: 'inherited' };
  const silentMs = request.silentMs ?? SILENT_MS;
  if (!deps.isAlive(holder.pid)) return { kind: 'left', holder, why: 'ended', silentMs };
  if (deps.now() - found.touchedAtMs >= silentMs)
    return { kind: 'left', holder, why: 'silent', silentMs };
  return { kind: 'held', holder };
}

/** Names each new holder once, then reminds every `reminderMs`, and says how long it waited. */
function createWaitingLines(
  now: () => number,
  say: (notice: LockNotice) => void,
  reminderMs: number,
): { heldBy(holder: LockRecord, file: string): void; taken(): void } {
  const startedAt = now();
  let announced: string | null = null;
  let remindAt = 0;
  return {
    heldBy(holder, file) {
      if (holder.token !== announced) {
        say({ kind: 'waiting', holder, file, nowMs: now() });
        announced = holder.token;
        remindAt = now() + reminderMs;
      } else if (now() >= remindAt) {
        say({ kind: 'still-waiting', holder, waitedMs: now() - startedAt });
        remindAt += reminderMs;
      }
    },
    taken() {
      if (announced !== null) say({ kind: 'taken', waitedMs: now() - startedAt });
    },
  };
}

/**
 * Removes the lock file whose text was `left`, moving it `aside` first: of two runs that found it,
 * only one moves it. False when another run removed it first, or replaced it with a lock of its
 * own before this run moved it (then the moved lock goes back).
 */
async function takeOver(
  files: LockFiles,
  file: string,
  aside: string,
  left: string,
): Promise<boolean> {
  if (!(await files.move(file, aside))) return false;
  const moved = await files.read(aside);
  const replaced = moved !== null && moved.text !== left;
  if (replaced) await files.create(file, moved.text);
  await files.remove(aside);
  return !replaced;
}
