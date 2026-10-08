/**
 * Turns a run's findings into the baseline file: file → function → metric → value, every level
 * sorted so the file diffs cleanly. A metric with several findings in one function keeps them all,
 * largest first. An inline eslint comment (`no-inline-config`) is never recorded: ESLint ignores
 * it, so the only fix is to remove it, and the gate keeps failing until then.
 */
import type { Baseline, Finding } from './types';

function sortedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Findings the baseline never accepts. */
const NEVER_RECORDED = new Set(['no-inline-config']);

export function buildBaseline(findings: Finding[]): Baseline {
  const values: Record<string, Record<string, Record<string, number[]>>> = {};
  const recorded = findings.filter((finding) => !NEVER_RECORDED.has(finding.metric));
  for (const { file, key, metric, value } of recorded) {
    const functions = values[file] ?? {};
    const metrics = functions[key] ?? {};
    metrics[metric] = [...(metrics[metric] ?? []), value];
    functions[key] = metrics;
    values[file] = functions;
  }
  const baseline: Baseline = {};
  for (const [file, functions] of sortedEntries(values)) {
    const outFunctions: Record<string, Record<string, number | number[]>> = {};
    for (const [key, metrics] of sortedEntries(functions)) {
      const outMetrics: Record<string, number | number[]> = {};
      for (const [metric, list] of sortedEntries(metrics)) {
        const sorted = [...list].sort((a, b) => b - a);
        const [only] = sorted;
        outMetrics[metric] = sorted.length === 1 && only !== undefined ? only : sorted;
      }
      outFunctions[key] = outMetrics;
    }
    baseline[file] = outFunctions;
  }
  return baseline;
}
