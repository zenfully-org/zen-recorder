import { execFileSync } from 'node:child_process';
import { escapePath } from 'tinyglobby';

/**
 * The files git tracks under `cwd`, as tinyglobby patterns that each match that one file. The
 * sources zip is built from them, so a file git does not track (a scratch script, a recording,
 * local notes) never reaches it, whatever its name. Hidden files and folders stay out unless `dot`
 * is set, as wxt's `dotSources` decides for its own patterns. Throws outside a git working copy.
 */
export function listTrackedSources({ cwd, dot }: { cwd: string; dot: boolean }): string[] {
  // stderr piped: git's reason ends up in the thrown error instead of the terminal.
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return tracked
    .split('\0')
    .filter((file) => file !== '' && (dot || !file.split('/').some((part) => part.startsWith('.'))))
    .map((file) => escapePath(file));
}
