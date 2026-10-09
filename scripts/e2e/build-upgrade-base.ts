/**
 * Builds the test flavour (`pnpm build:e2e`) of the release e2e scenario 88 updates from
 * (`pickUpgradeBase`, or the commit `E2E_UPGRADE_FROM` names), in a temporary git worktree of its
 * commit. The build is kept in `node_modules/.cache/zen-recorder/upgrade-from/<commit>/`, so the
 * next run on the same machine reuses it.
 *
 * A clone that lacks the commit fetches it from `origin` first: one commit deep in a shallow clone
 * (CI checks out one commit), the plain way in a full one, which a `--depth` fetch would make
 * shallow.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './harness';
import { pickUpgradeBase } from './pick-upgrade-base';

const CACHE_DIR = path.join(ROOT, 'node_modules/.cache/zen-recorder/upgrade-from');

const run = (command: string, args: string[], cwd = ROOT): string =>
  execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function hasCommit(commit: string): boolean {
  try {
    run('git', ['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function fetchCommit(commit: string): void {
  if (hasCommit(commit)) return;
  const shallow = run('git', ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  run('git', ['fetch', '--no-tags', ...(shallow ? ['--depth=1'] : []), 'origin', commit]);
}

/** The release to update from: its name for the log, and its built extension. */
export function buildUpgradeBase(): { name: string; dir: string } {
  const pinned = process.env['E2E_UPGRADE_FROM'];
  const base = pinned
    ? { commit: run('git', ['rev-parse', pinned]).trim(), name: pinned }
    : pickUpgradeBase(
        run('git', ['ls-remote', '--tags', '--refs', '--sort=-v:refname', 'origin', 'v*']),
      );
  const dir = path.join(CACHE_DIR, base.commit);
  const name = `${base.name} (${base.commit.slice(0, 7)})`;
  if (existsSync(path.join(dir, 'manifest.json'))) return { name, dir };
  fetchCommit(base.commit);
  const worktree = mkdtempSync(path.join(os.tmpdir(), 'zen-recorder-upgrade-from-'));
  try {
    run('git', ['worktree', 'add', '--detach', worktree, base.commit]);
    run('pnpm', ['install', '--frozen-lockfile'], worktree);
    run('pnpm', ['build:e2e'], worktree);
    cpSync(path.join(worktree, '.output/firefox-mv3'), dir, { recursive: true });
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    run('git', ['worktree', 'prune']);
  }
  return { name, dir };
}
