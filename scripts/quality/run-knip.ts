/**
 * Runs knip with knip.jsonc and returns what it found as findings for the quality baseline:
 * unused files, exports, types and dependencies, unresolved imports and unlisted binaries. knip
 * reads git's ignore files itself, so a scratch folder in .git/info/exclude stays out. With
 * `--no-exit-code` knip exits with 0 whatever it found; any other exit is its own failure, such as
 * a configuration it refuses.
 */
import { parseKnipReport } from './parse-knip-report';
import type { Finding } from './types';

export interface KnipDeps {
  /** Runs the knip CLI with these arguments, from the repository root. */
  exec: (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;
}

const ARGS = ['--reporter', 'json', '--no-progress', '--no-exit-code'];

export async function runKnip(deps: KnipDeps): Promise<Finding[]> {
  const { code, stdout, stderr } = await deps.exec(ARGS);
  if (code !== 0) throw new Error(`knip exited with ${code}: ${(stderr || stdout).trim()}`);
  return parseKnipReport(stdout);
}
