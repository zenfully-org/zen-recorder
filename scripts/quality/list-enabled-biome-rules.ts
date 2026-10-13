/**
 * The lint rules Biome enables for the folder `root`, as `biome rage --linter` lists them with the
 * folder's configuration: `group/rule`, like `suspicious/noDebugger`. Biome has no machine-readable
 * listing of them; the report names each on a line of its own, under "Enabled rules:".
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function listEnabledBiomeRules(root: string): string[] {
  const biome = require.resolve('@biomejs/biome/bin/biome');
  const text = execFileSync(process.execPath, [biome, 'rage', '--linter'], {
    cwd: root,
    encoding: 'utf8',
  });
  return text
    .slice(text.indexOf('Enabled rules:'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-zA-Z0-9]+\/[a-zA-Z0-9]+$/.test(line));
}
