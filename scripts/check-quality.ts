/**
 * The quality gate: per-function and per-file metrics and SonarQube's code smells (ESLint with the
 * rules in eslint.config.js), unused files, exports, types and dependencies (knip with knip.jsonc)
 * and duplicated blocks (jscpd with .jscpd.json), each checked against a baseline of known
 * offenders that may only shrink: quality-baseline.json for the metrics, the smells and the unused
 * code, .jscpd-baseline.json for the clones. A finding the baseline does not know, or one above its
 * entry, fails; so does an entry the code no longer matches, until `--update-baseline` rewrites
 * both files from the current code. Circular imports (dependency-cruiser with
 * .dependency-cruiser.cjs) have no baseline: there are none, and any one fails. knip, jscpd and
 * dependency-cruiser run in child processes while ESLint lints in this one, so they add little to
 * the run's time. With `--report` (`pnpm quality:report`) a fourth child measures every function,
 * and the run also writes .quality/report.json and .quality/report.html, pass or fail.
 * Usage: `pnpm check:quality` (part of `pnpm check`), `pnpm check:quality --update-baseline`,
 * `pnpm quality:report`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { buildBaseline } from './quality/build-baseline';
import { buildReport, type ReportInput } from './quality/build-report';
import { collectEslintFindings } from './quality/collect-eslint-findings';
import { compareBaseline } from './quality/compare-baseline';
import { eslintCacheLocation } from './quality/eslint-cache-location';
import { formatSummary } from './quality/format-summary';
import { parseBaseline } from './quality/parse-baseline';
import { parseMeasurements } from './quality/parse-measurements';
import { renderReportHtml } from './quality/render-report-html';
import { runDependencyCruiser } from './quality/run-dependency-cruiser';
import { runJscpd } from './quality/run-jscpd';
import { runKnip } from './quality/run-knip';
import type { Baseline, Finding, Measurements, Summary } from './quality/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'quality-baseline.json');
const LOCKFILE = path.join(ROOT, 'pnpm-lock.yaml');
const JSCPD = path.join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js');
const KNIP = path.join(ROOT, 'node_modules', 'knip', 'bin', 'knip.js');
const BIOME = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const CRUISE_IMPORTS = path.join(ROOT, 'scripts', 'quality', 'cruise-imports.ts');
const MEASURE_FUNCTIONS = path.join(ROOT, 'scripts', 'quality', 'measure-functions.ts');
const REPORT_DIR = path.join(ROOT, '.quality');
const LINTED = ['src', 'scripts', 'wxt.config.ts', 'vitest.config.ts'];

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readBaseline(): Promise<Baseline | null> {
  try {
    return parseBaseline(await readFile(BASELINE_FILE, 'utf8'));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    console.log(
      'No quality-baseline.json yet: pnpm check:quality --update-baseline writes it from the current code.',
    );
    return null;
  }
}

/**
 * The files git does not ignore under the linted roots, relative to the root: tracked ones and new
 * ones, but nothing from a scratch folder in .gitignore or .git/info/exclude, like Biome.
 */
function listGitFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...LINTED],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return listed.split('\0').filter((file) => file !== '');
}

/** The TypeScript files among them that are on disk (a deleted file git still tracks is not). */
function listLintedFiles(files: string[]): string[] {
  return files
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => path.join(ROOT, file))
    .filter((file) => existsSync(file));
}

/** The gate passes when nothing failed: no finding beyond the baseline, no new or vanished clone, no broken import rule. */
function isPassing(summary: Summary): boolean {
  return (
    summary.failures.length === 0 &&
    summary.newClones.length === 0 &&
    summary.staleClones === 0 &&
    summary.importViolations.length === 0
  );
}

function countEntries(baseline: Baseline): number {
  return Object.values(baseline)
    .flatMap((functions) => Object.values(functions))
    .reduce((count, metrics) => count + Object.keys(metrics).length, 0);
}

/** Runs this Node.js with these arguments, from the root, without blocking ESLint; `input` goes to its standard input. */
function execNode(
  args: string[],
  input?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      args,
      { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

/** dependency-cruiser's JSON report on these folders, from scripts/quality/cruise-imports.ts. */
async function cruiseImports(paths: string[]): Promise<string> {
  const { code, stdout, stderr } = await execNode(['--import', 'tsx', CRUISE_IMPORTS, ...paths]);
  if (code !== 0) throw new Error((stderr || stdout).trim());
  return stdout;
}

/** Every function's metrics for the report, from scripts/quality/measure-functions.ts. */
async function measure(files: string[]): Promise<Measurements> {
  const input = JSON.stringify(listLintedFiles(files));
  const { code, stdout, stderr } = await execNode(['--import', 'tsx', MEASURE_FUNCTIONS], input);
  if (code !== 0) throw new Error(`measuring the functions failed: ${(stderr || stdout).trim()}`);
  return parseMeasurements(stdout);
}

async function writeReport(input: ReportInput): Promise<void> {
  const report = buildReport(input);
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(REPORT_DIR, 'report.html'), renderReportHtml(report));
  console.log('Report: .quality/report.html (and .quality/report.json)');
}

/** Removes the caches of earlier lockfiles, which no run reads again. */
async function pruneOtherCaches(cacheLocation: string): Promise<void> {
  const dir = path.dirname(cacheLocation);
  const entries = await readdir(dir).catch((error: unknown) => {
    if (isMissingFile(error)) return [];
    throw error;
  });
  const others = entries.filter((entry) => entry !== path.basename(cacheLocation));
  await Promise.all(others.map((entry) => rm(path.join(dir, entry), { force: true })));
}

/**
 * Lints with ESLint's cache: a file whose contents, configuration and packages are unchanged gets
 * its last results, findings included, without being linted again. CI starts without a cache.
 */
async function lint(files: string[]): Promise<Finding[]> {
  const cacheLocation = eslintCacheLocation(ROOT, await readFile(LOCKFILE, 'utf8'));
  await pruneOtherCaches(cacheLocation);
  const eslint = new ESLint({
    cwd: ROOT,
    warnIgnored: false,
    cache: true,
    cacheLocation,
    cacheStrategy: 'content',
  });
  const results = await eslint.lintFiles(listLintedFiles(files));
  return collectEslintFindings(results, {
    root: ROOT,
    readSource: (file) => readFile(file, 'utf8'),
  });
}

/** Runs every check at once: the child processes start first, so they run while ESLint lints here. */
async function runChecks(files: string[], options: { updateBaseline: boolean; report: boolean }) {
  const listed = new Set(files);
  const [measurements, importViolations, jscpd, unused, metrics] = await Promise.all([
    options.report ? measure(files) : null,
    runDependencyCruiser({ cruise: cruiseImports, isListed: (file) => listed.has(file) }),
    runJscpd(
      {
        root: ROOT,
        exec: (args) => execNode([JSCPD, ...args]),
        readFile: (file) => readFile(file, 'utf8'),
        makeTempDir: () => mkdtemp(path.join(os.tmpdir(), 'zen-recorder-jscpd-')),
        removeDir: (dir) => rm(dir, { recursive: true, force: true }),
      },
      { updateBaseline: options.updateBaseline },
    ),
    runKnip({ exec: (args) => execNode([KNIP, ...args]) }),
    lint(files),
  ]);
  return { measurements, importViolations, jscpd, findings: [...metrics, ...unused] };
}

async function writeBaselines(findings: Finding[], clones: number): Promise<void> {
  const baseline = buildBaseline(findings);
  await writeFile(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  // Biome formats the JSON files of the repository (`pnpm check:lint`), short lists on one line.
  const formatted = await execNode([BIOME, 'format', '--write', BASELINE_FILE]);
  if (formatted.code !== 0) throw new Error(`biome format failed: ${formatted.stderr.trim()}`);
  console.log(
    `Baselines written: ${countEntries(baseline)} offenders in quality-baseline.json, ${clones} clones in .jscpd-baseline.json`,
  );
}

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes('--update-baseline');
  const report = process.argv.includes('--report') && !updateBaseline;
  const { measurements, importViolations, jscpd, findings } = await runChecks(listGitFiles(), {
    updateBaseline,
    report,
  });
  if (updateBaseline) {
    await writeBaselines(findings, jscpd.clones.length);
    return;
  }

  const baseline = (await readBaseline()) ?? {};
  const failures = compareBaseline(findings, baseline);
  const newClones = jscpd.clones.filter((clone) => clone.isNew);
  if (measurements !== null) {
    await writeReport({
      generatedAt: new Date().toISOString(),
      measurements,
      findings,
      baseline,
      failures,
      clones: jscpd.clones,
      staleClones: jscpd.staleClones,
      knownClones: jscpd.knownClones,
      importViolations,
    });
  }
  const summary = {
    failures,
    newClones,
    staleClones: jscpd.staleClones,
    knownOffenders: countEntries(baseline),
    knownClones: jscpd.knownClones,
    importViolations,
  };
  console.log(formatSummary(summary));
  if (!isPassing(summary)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`check-quality failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
