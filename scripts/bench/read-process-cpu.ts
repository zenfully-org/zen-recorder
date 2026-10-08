/**
 * CPU time of a browser's process tree, read from Linux `/proc`: every descendant of the launched
 * Firefox, grouped by process kind (`tab` content processes, `gpu`, `rdd`, `utility`, `socket`,
 * the parent `main`). Used by `scripts/bench-recording.ts` to report how many cores a recording
 * costs per phase. Linux only; returns an empty list elsewhere.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

export interface ProcessCpu {
  pid: number;
  kind: string;
  /** utime + stime in seconds. */
  cpuS: number;
}

const CLOCK_TICKS = 100;

function readStat(pid: number): { ppid: number; cpuS: number } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may contain spaces: split after the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(fields[1]);
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    return { ppid, cpuS: (utime + stime) / CLOCK_TICKS };
  } catch {
    return null;
  }
}

function kindOf(pid: number, rootPid: number): string {
  if (pid === rootPid) return 'main';
  try {
    // Firefox's children rewrite their argv into one string: the kind is its last word.
    const words = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split(/[\0\s]+/)
      .filter(Boolean);
    return words.at(-1) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function readProcessCpu(rootPid: number): ProcessCpu[] {
  if (!existsSync('/proc')) return [];
  const parents = new Map<number, number[]>();
  const cpu = new Map<number, number>();
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    const stat = readStat(pid);
    if (!stat) continue;
    cpu.set(pid, stat.cpuS);
    parents.set(stat.ppid, [...(parents.get(stat.ppid) ?? []), pid]);
  }
  const tree: number[] = [];
  const queue = [rootPid];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    if (!cpu.has(pid)) continue;
    tree.push(pid);
    queue.push(...(parents.get(pid) ?? []));
  }
  return tree.map((pid) => ({ pid, kind: kindOf(pid, rootPid), cpuS: cpu.get(pid) ?? 0 }));
}

/** Firefox processes running on this machine that do not belong to `rootPid`'s tree. */
export function foreignFirefoxPids(rootPid: number | null): number[] {
  const own = new Set(rootPid === null ? [] : readProcessCpu(rootPid).map((p) => p.pid));
  if (!existsSync('/proc')) return [];
  return readdirSync('/proc')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && !own.has(pid))
    .filter((pid) => {
      try {
        const exe = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0\s]+/)[0] ?? '';
        return /(^|\/)firefox(-bin)?$/.test(exe);
      } catch {
        return false;
      }
    });
}
