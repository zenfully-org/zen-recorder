/**
 * Runs jscpd over the code with the clone baseline and reads its report. jscpd marks the clones
 * the baseline does not know as new; the baseline's own count says whether known clones are gone,
 * which the report cannot show. With `updateBaseline`, jscpd rewrites the baseline from this run;
 * without a baseline file yet, every clone is new.
 */
import path from 'node:path';
import { parseJscpdBaseline } from './parse-jscpd-baseline';
import { parseJscpdReport } from './parse-jscpd-report';
import type { Clone } from './types';

export interface JscpdDeps {
  root: string;
  /** Runs the jscpd binary with these arguments, from the repository root. */
  exec: (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  readFile: (file: string) => Promise<string>;
  makeTempDir: () => Promise<string>;
  removeDir: (dir: string) => Promise<void>;
}

export interface JscpdResult {
  clones: Clone[];
  knownClones: number;
  staleClones: number;
}

const BASELINE = '.jscpd-baseline.json';
const PATHS = ['src', 'scripts', 'wxt.config.ts', 'vitest.config.ts'];

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readOptional(deps: JscpdDeps, file: string): Promise<string | null> {
  try {
    return await deps.readFile(file);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function runJscpd(
  deps: JscpdDeps,
  options: { updateBaseline: boolean },
): Promise<JscpdResult> {
  const baselineFile = path.join(deps.root, BASELINE);
  // Without a baseline yet, every clone is new; `--update-baseline` writes the first one.
  const hasBaseline = (await readOptional(deps, baselineFile)) !== null;
  const useBaseline = hasBaseline || options.updateBaseline;
  const tmp = await deps.makeTempDir();
  try {
    const args = [
      ...PATHS,
      '--reporters',
      'json',
      '--output',
      tmp,
      '--absolute',
      '--silent',
      '--no-tips',
      ...(useBaseline ? ['--baseline', BASELINE] : []),
      ...(options.updateBaseline ? ['--update-baseline'] : []),
    ];
    const { code, stdout, stderr } = await deps.exec(args);
    if (code !== 0) throw new Error(`jscpd exited with ${code}: ${(stderr || stdout).trim()}`);
    const report = await deps.readFile(path.join(tmp, 'jscpd-report.json'));
    // jscpd flags nothing as new when it ran without a baseline: then everything is.
    const { clones } = useBaseline
      ? parseJscpdReport(report, deps.root)
      : {
          clones: parseJscpdReport(report, deps.root).clones.map((clone) => ({
            ...clone,
            isNew: true,
          })),
        };
    const knownClones = clones.filter((clone) => !clone.isNew).length;
    const baseline = await readOptional(deps, baselineFile);
    const total = baseline === null ? knownClones : parseJscpdBaseline(baseline).total;
    return { clones, knownClones, staleClones: Math.max(0, total - knownClones) };
  } finally {
    await deps.removeDir(tmp);
  }
}
