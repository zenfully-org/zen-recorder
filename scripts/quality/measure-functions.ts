/**
 * Measures every function and file for the quality report and prints the result as JSON
 * (parse-measurements.ts reads it): the value of each metric that has one, whatever its threshold,
 * and the thresholds that apply to each file. It lints with eslint.config.js, every rule off but
 * the metric rules that report a value, set to a threshold of 0 so that ESLint reports every
 * function. The thresholds come from ESLint's own configuration of each file. `max-params` also
 * counts the parameters of a function type (`(file: string) => boolean` in an interface), which is
 * no function and sits outside every one: such values are left out. check-quality.ts
 * runs it as a child process for `pnpm quality:report`, beside the gate's own ESLint, and writes
 * the files to lint (absolute paths, a JSON list) to its standard input.
 * Usage: `node --import tsx scripts/quality/measure-functions.ts < files.json`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { z } from 'zod';
import { collectEslintFindings } from './collect-eslint-findings';
import { readRuleThreshold } from './read-rule-threshold';
import { relativeToRoot } from './relative-to-root';
import type { Measurements } from './types';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The metric rules that report a value, at the threshold that makes them report every function. */
const MEASURED: Linter.RulesRecord = {
  'sonarjs/cognitive-complexity': ['error', 0],
  'sonarjs/cyclomatic-complexity': ['error', { threshold: 0 }],
  'sonarjs/max-lines-per-function': ['error', { maximum: 0 }],
  'sonarjs/max-lines': ['error', { maximum: 0 }],
  'max-params': ['error', 0],
  'max-statements': ['error', 0],
  'max-nested-callbacks': ['error', 0],
};

/** The measured metrics that belong to a file, not a function. */
const FILE_METRICS = new Set(['max-lines']);

const FILES = z.array(z.string());
const CONFIG = z.object({
  default: z.array(z.object({ rules: z.record(z.string(), z.unknown()).optional() })),
});
/** What `calculateConfigForFile` gives: the file's rules, or nothing for a file ESLint ignores. */
const FILE_CONFIG = z.object({ rules: z.record(z.string(), z.unknown()) }).optional();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Every rule eslint.config.js configures, turned off. */
async function everyRuleOff(): Promise<Record<string, 'off'>> {
  const config = CONFIG.parse(
    await import(pathToFileURL(path.join(ROOT, 'eslint.config.js')).href),
  );
  const names = config.default.flatMap((block) => Object.keys(block.rules ?? {}));
  return Object.fromEntries(names.map((name) => [name, 'off' as const]));
}

async function thresholdsOf(files: string[]): Promise<Measurements['thresholds']> {
  const eslint = new ESLint({ cwd: ROOT });
  const thresholds: Measurements['thresholds'] = {};
  for (const file of files) {
    const config = FILE_CONFIG.parse(await eslint.calculateConfigForFile(file));
    if (config === undefined) continue;
    const own: Record<string, number> = {};
    for (const rule of Object.keys(MEASURED)) {
      const threshold = readRuleThreshold(config.rules[rule]);
      if (threshold !== null) own[rule.replace(/^sonarjs\//, '')] = threshold;
    }
    thresholds[relativeToRoot(file, ROOT)] = own;
  }
  return thresholds;
}

async function main(): Promise<void> {
  const files = FILES.parse(JSON.parse(await readStdin()));
  const eslint = new ESLint({
    cwd: ROOT,
    warnIgnored: false,
    overrideConfig: [
      { rules: await everyRuleOff() },
      { files: ['**/*.ts', '**/*.tsx'], rules: MEASURED },
    ],
  });
  const results = await eslint.lintFiles(files);
  const findings = await collectEslintFindings(results, {
    root: ROOT,
    readSource: (file) => readFile(file, 'utf8'),
  });
  const measurements = findings
    .filter(({ key, metric }) => (key === 'file') === FILE_METRICS.has(metric))
    .map(({ file, line, key, metric, value }) => ({
      file,
      line,
      key,
      metric,
      value,
    }));
  const output: Measurements = { measurements, thresholds: await thresholdsOf(files) };
  process.stdout.write(JSON.stringify(output));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
