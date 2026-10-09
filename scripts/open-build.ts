/**
 * Opens the built extension (`.output/firefox-mv3`) in Windows Explorer, for a temporary install
 * from Windows: on Windows itself, and inside WSL2 through `wslpath`. Anywhere else it says what it
 * is for. With `--dry-run` it prints the command instead of running it. Explorer exits with 1 even
 * when it opened the folder, so its status is not read.
 *
 * Usage: `pnpm open:build` (or `pnpm exec tsx scripts/open-build.ts --dry-run`).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { explorerCommand } from './explorer-command';

const folder = path.resolve(import.meta.dirname, '../.output/firefox-mv3');
const command = explorerCommand(folder, {
  platform: process.platform,
  windowsPathOf: (unixPath) => {
    const result = spawnSync('wslpath', ['-w', unixPath], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  },
});

if (command === null) {
  console.log(
    'open:build is for Windows and WSL2: it opens .output/firefox-mv3 in Windows Explorer',
  );
} else if (process.argv.includes('--dry-run')) {
  console.log([command.program, ...command.args].join(' '));
} else {
  spawnSync(command.program, command.args);
}
