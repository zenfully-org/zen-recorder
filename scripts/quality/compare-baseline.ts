/**
 * Compares a run's findings with the checked-in baseline, function by function and metric by
 * metric. A finding without an entry is a new offender; one above its entry got worse. One below
 * its entry improved, and an entry nothing matches is stale: both fail too, until the baseline is
 * rewritten, so it can only shrink and every gain is recorded. When one function has several
 * findings of a metric, each current value takes the entry that equals it, else the smallest
 * entry above it (improved), else the largest one left (worse); values with no entry left are new,
 * entries with no value left are improved.
 */
import type { Baseline, Failure, Finding } from './types';

function valuesOf(entry: number | number[]): number[] {
  return [...(Array.isArray(entry) ? entry : [entry])].sort((a, b) => b - a);
}

function groupKey(file: string, key: string, metric: string): string {
  return `${file}\u0000${key}\u0000${metric}`;
}

function compareGroup(current: Finding[], known: number[]): Failure[] {
  const [first] = current;
  if (first === undefined) return [];
  const { file, key, metric } = first;
  const unused = [...known];
  const failures: Failure[] = [];
  const take = (index: number): number => {
    const [value] = unused.splice(index, 1);
    return value ?? 0;
  };
  for (const finding of [...current].sort((a, b) => b.value - a.value)) {
    const common = { file, key, metric, threshold: finding.threshold, line: finding.line };
    const exact = unused.indexOf(finding.value);
    if (exact >= 0) {
      take(exact);
      continue;
    }
    const above = unused.filter((value) => value > finding.value);
    if (above.length > 0) {
      const baseline = take(unused.indexOf(Math.min(...above)));
      failures.push({ kind: 'improved', value: finding.value, baseline, ...common });
    } else if (unused.length > 0) {
      const baseline = take(unused.indexOf(Math.max(...unused)));
      failures.push({ kind: 'worse', value: finding.value, baseline, ...common });
    } else {
      failures.push({ kind: 'new', value: finding.value, baseline: null, ...common });
    }
  }
  for (const baseline of unused) {
    failures.push({
      kind: 'improved',
      value: null,
      baseline,
      file,
      key,
      metric,
      threshold: null,
      line: null,
    });
  }
  return failures;
}

function byPlace(a: Failure, b: Failure): number {
  const left = `${a.file}\u0000${a.key}\u0000${a.metric}`;
  const right = `${b.file}\u0000${b.key}\u0000${b.metric}`;
  if (left === right) return (a.line ?? 0) - (b.line ?? 0);
  return left < right ? -1 : 1;
}

export function compareBaseline(findings: Finding[], baseline: Baseline): Failure[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const id = groupKey(finding.file, finding.key, finding.metric);
    groups.set(id, [...(groups.get(id) ?? []), finding]);
  }
  const failures: Failure[] = [];
  const seen = new Set<string>();
  for (const [id, current] of groups) {
    seen.add(id);
    const [first] = current;
    if (first === undefined) continue;
    const entry = baseline[first.file]?.[first.key]?.[first.metric];
    failures.push(...compareGroup(current, entry === undefined ? [] : valuesOf(entry)));
  }
  for (const [file, functions] of Object.entries(baseline)) {
    for (const [key, metrics] of Object.entries(functions)) {
      for (const [metric, entry] of Object.entries(metrics)) {
        if (seen.has(groupKey(file, key, metric))) continue;
        const [largest] = valuesOf(entry);
        failures.push({
          kind: 'stale',
          file,
          key,
          metric,
          value: null,
          baseline: largest ?? 0,
          threshold: null,
          line: null,
        });
      }
    }
  }
  return failures.sort(byPlace);
}
