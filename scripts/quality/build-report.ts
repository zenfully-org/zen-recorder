/**
 * Builds the quality report (`.quality/report.json`, version 1) from one run: every file and
 * function with every metric measured on it (whatever its threshold), how each metric spreads
 * (median, 90th percentile, largest), the 20 largest values per metric, the baseline with what the
 * code has now, and the run's failures, clones and broken import rules. A metric a function has no
 * value for counts as 0 (a function without parameters gets no `max-params` message).
 */
import type {
  Baseline,
  Clone,
  Distribution,
  Failure,
  Finding,
  ImportViolation,
  Measurement,
  Measurements,
  QualityReport,
  ReportBaselineEntry,
  ReportFile,
  ReportFunction,
  WorstEntry,
} from './types';

export interface ReportInput {
  generatedAt: string;
  measurements: Measurements;
  /** The gate's own findings: values over their threshold, code smells, unused code. */
  findings: Finding[];
  baseline: Baseline;
  failures: Failure[];
  clones: Clone[];
  staleClones: number;
  knownClones: number;
  importViolations: ImportViolation[];
}

/** The order the per-function metrics are shown in; a metric not listed comes after, by name. */
const ORDER = [
  'cognitive-complexity',
  'cyclomatic-complexity',
  'max-lines-per-function',
  'max-statements',
  'max-params',
  'max-nested-callbacks',
];
const WORST = 20;

function byName(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function metricOrder(a: string, b: string): number {
  const rank = (metric: string) => (ORDER.includes(metric) ? ORDER.indexOf(metric) : ORDER.length);
  return rank(a) - rank(b) || byName(a, b);
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/** The nearest-rank percentile of values sorted from small to large. */
function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function distribution(metric: string, values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    metric,
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted.at(-1) ?? 0,
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

function buildFile(
  file: string,
  measured: Measurement[],
  thresholds: Record<string, number>,
  functionMetrics: string[],
): ReportFile {
  const metrics: Record<string, number> = {};
  for (const m of measured.filter((m) => m.key === 'file')) metrics[m.metric] = m.value;
  const functions: ReportFunction[] = [];
  for (const [key, own] of groupBy(
    measured.filter((m) => m.key !== 'file'),
    (m) => m.key,
  )) {
    const values = Object.fromEntries(functionMetrics.map((metric) => [metric, 0]));
    for (const m of own) values[m.metric] = Math.max(values[m.metric] ?? 0, m.value);
    const lines = own.map((m) => m.line).filter((line) => line > 0);
    functions.push({ key, line: Math.min(...lines), metrics: values });
  }
  functions.sort((a, b) => a.line - b.line || byName(a.key, b.key));
  return { file, thresholds, metrics, functions };
}

function worstOf(metric: string, entries: WorstEntry[]): { metric: string; entries: WorstEntry[] } {
  const ranked = [...entries].sort(
    (a, b) => b.value - a.value || byName(a.file, b.file) || byName(a.key, b.key),
  );
  return { metric, entries: ranked.slice(0, WORST) };
}

function placeKey(file: string, key: string, metric: string): string {
  return `${file}\u0000${key}\u0000${metric}`;
}

function baselineEntries(input: ReportInput): ReportBaselineEntry[] {
  const found = groupBy(input.findings, (f) => placeKey(f.file, f.key, f.metric));
  const measured = groupBy(input.measurements.measurements, (m) =>
    placeKey(m.file, m.key, m.metric),
  );
  const entries: ReportBaselineEntry[] = [];
  for (const file of Object.keys(input.baseline).sort(byName)) {
    const functions = input.baseline[file] ?? {};
    for (const key of Object.keys(functions).sort(byName)) {
      const metrics = functions[key] ?? {};
      for (const metric of Object.keys(metrics).sort(byName)) {
        const known = metrics[metric] ?? [];
        const place = placeKey(file, key, metric);
        const now = found.get(place) ?? measured.get(place) ?? [];
        entries.push({
          file,
          key,
          metric,
          baseline: [known].flat().sort((a, b) => b - a),
          current: now.map((item) => item.value).sort((a, b) => b - a),
        });
      }
    }
  }
  return entries;
}

export function buildReport(input: ReportInput): QualityReport {
  const { measurements, thresholds } = input.measurements;
  const functionMetrics = distinct(
    measurements.filter((m) => m.key !== 'file').map((m) => m.metric),
  ).sort(metricOrder);
  const fileMetrics = distinct(
    measurements.filter((m) => m.key === 'file').map((m) => m.metric),
  ).sort(byName);
  const byFile = groupBy(measurements, (m) => m.file);
  const fileNames = distinct([...byFile.keys(), ...Object.keys(thresholds)]).sort(byName);
  const files = fileNames.map((file) =>
    buildFile(file, byFile.get(file) ?? [], thresholds[file] ?? {}, functionMetrics),
  );
  const rows = files.flatMap((f) => f.functions.map((fn) => ({ file: f, fn })));
  const functionEntries = (metric: string): WorstEntry[] =>
    rows.map(({ file, fn }) => ({
      file: file.file,
      key: fn.key,
      line: fn.line,
      value: fn.metrics[metric] ?? 0,
      threshold: file.thresholds[metric] ?? null,
    }));
  const fileEntries = (metric: string): WorstEntry[] =>
    files
      .filter((f) => f.metrics[metric] !== undefined)
      .map((f) => ({
        file: f.file,
        key: 'file',
        line: 0,
        value: f.metrics[metric] ?? 0,
        threshold: f.thresholds[metric] ?? null,
      }));
  const perMetric = [
    ...functionMetrics.map((metric) => ({ metric, entries: functionEntries(metric) })),
    ...fileMetrics.map((metric) => ({ metric, entries: fileEntries(metric) })),
  ];
  const newClones = input.clones.filter((clone) => clone.isNew).length;
  const baseline = baselineEntries(input);
  return {
    version: 1,
    generatedAt: input.generatedAt,
    passed:
      input.failures.length === 0 &&
      newClones === 0 &&
      input.staleClones === 0 &&
      input.importViolations.length === 0,
    summary: {
      files: files.length,
      functions: rows.length,
      failures: input.failures.length,
      newClones,
      staleClones: input.staleClones,
      importViolations: input.importViolations.length,
      knownOffenders: baseline.length,
      knownClones: input.knownClones,
    },
    functionMetrics,
    fileMetrics,
    distributions: perMetric.map(({ metric, entries }) =>
      distribution(
        metric,
        entries.map((e) => e.value),
      ),
    ),
    worst: perMetric.map(({ metric, entries }) => worstOf(metric, entries)),
    files,
    failures: input.failures,
    baseline,
    clones: input.clones,
    importViolations: input.importViolations,
  };
}
