/**
 * The lines a run prints about the browser lock: whom it waits for (once per holder, then a short
 * reminder every minute), how long it waited once it has the lock, and why it takes over a lock
 * whose holder is gone. A run that finds the lock free prints nothing.
 */
import type { LockRecord } from './parse-lock-record';

export type LockNotice =
  | { kind: 'waiting'; holder: LockRecord; file: string; nowMs: number }
  | { kind: 'still-waiting'; holder: LockRecord; waitedMs: number }
  | { kind: 'taken'; waitedMs: number }
  /** `ended`: its process is gone; `silent`: it has not touched the file for `silentMs`. */
  | { kind: 'taken-over'; holder: LockRecord; why: 'ended' | 'silent'; silentMs: number };

export function describeLockNotice(notice: LockNotice, home: string): string {
  switch (notice.kind) {
    case 'waiting':
      return `browser lock: waiting for ${whoHolds(notice.holder, home)}, which has held it for ${formatDuration(notice.nowMs - notice.holder.takenAt)}; one run at a time starts Firefox on this machine (${notice.file})`;
    case 'still-waiting':
      return `browser lock: still waiting for ${notice.holder.command} (pid ${notice.holder.pid}), ${formatDuration(notice.waitedMs)} so far`;
    case 'taken':
      return `browser lock: taken after ${formatDuration(notice.waitedMs)} of waiting`;
    case 'taken-over':
      return notice.why === 'ended'
        ? `browser lock: ${whoHolds(notice.holder, home)} ended without releasing it; taking it over`
        : `browser lock: ${whoHolds(notice.holder, home)} has not touched it for ${formatDuration(notice.silentMs)} (its pid may belong to another program now); taking it over`;
  }
}

function whoHolds(holder: LockRecord, home: string): string {
  return `${holder.command} (pid ${holder.pid}, in ${shorten(holder.workingCopy, home)})`;
}

/** The folder, with the home folder written `~`. */
function shorten(folder: string, home: string): string {
  const rest = folder.slice(home.length);
  return folder.startsWith(home) && /^([/\\]|$)/.test(rest) ? `~${rest}` : folder;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return joinUnits(minutes, 'min', seconds % 60, 's');
  return joinUnits(Math.floor(minutes / 60), 'h', minutes % 60, 'min');
}

const joinUnits = (big: number, bigUnit: string, small: number, smallUnit: string): string =>
  small === 0 ? `${big} ${bigUnit}` : `${big} ${bigUnit} ${small} ${smallUnit}`;
