/**
 * The data the quality gate works with: one finding per function (or file) and metric, the
 * checked-in baseline of known offenders, the failures a run reports, the clones jscpd found and
 * the import rules dependency-cruiser found broken.
 */

/** One metric value ESLint reported, placed on the function (or file) it belongs to. */
export interface Finding {
  /** Path relative to the repository root, with forward slashes. */
  file: string;
  /** The line ESLint reported, 1-based (0 for a file-level metric). */
  line: number;
  /** The enclosing-function chain, like `createPageSession > handle > arrow#2`, or `file`. */
  key: string;
  /** The rule's name without its plugin prefix, like `cognitive-complexity`. */
  metric: string;
  /** The measured value, or 1 for a rule that only says yes or no. */
  value: number;
  /** The threshold the rule applied, when its message says it. */
  threshold: number | null;
}

/** file → function key → metric → the known value(s); several values when one function has several findings. */
export type Baseline = Record<string, Record<string, Record<string, number | number[]>>>;

export type FailureKind = 'new' | 'worse' | 'improved' | 'stale';

export interface Failure {
  kind: FailureKind;
  file: string;
  key: string;
  metric: string;
  /** The current value; null for a stale entry. */
  value: number | null;
  /** The baseline value; null for a new offender. */
  baseline: number | null;
  threshold: number | null;
  line: number | null;
}

export interface CloneLocation {
  file: string;
  line: number;
}

export interface Clone {
  lines: number;
  isNew: boolean;
  first: CloneLocation;
  second: CloneLocation;
}

/** An import that breaks a rule of .dependency-cruiser.cjs. */
export interface ImportViolation {
  /** The rule's name, like `no-circular`. */
  rule: string;
  /** The importing file, relative to the repository root with forward slashes. */
  from: string;
  /** For a circular import, every file it runs through, back to `from`; otherwise the import as written. */
  to: string[];
}

/** One function's (or file's) value of a metric, measured whatever its threshold. */
export interface Measurement {
  file: string;
  /** The line of the function, 0 for a file-level metric. */
  line: number;
  /** The enclosing-function chain, like `createPageSession > handle`, or `file`. */
  key: string;
  metric: string;
  value: number;
}

/** Every measured value, and per file the thresholds that apply to it (metric → threshold). */
export interface Measurements {
  measurements: Measurement[];
  thresholds: Record<string, Record<string, number>>;
}

export interface Summary {
  /** What fails the run. */
  failures: Failure[];
  newClones: Clone[];
  /** Fingerprints in the clone baseline that no clone matched any more, when they fail the run (`--strict`). */
  staleClones: number;
  knownOffenders: number;
  knownClones: number;
  importViolations: ImportViolation[];
  /** Entries the code is better than, which pass: improved values, gone findings, stale entries. */
  slack: Failure[];
  /** Fingerprints in the clone baseline that no clone matched any more, when they pass. */
  goneClones: number;
}

/** A function in the report: its line and every metric measured on it (0 when it has none). */
export interface ReportFunction {
  key: string;
  line: number;
  metrics: Record<string, number>;
}

export interface ReportFile {
  file: string;
  /** The thresholds that apply to this file, metric → threshold. */
  thresholds: Record<string, number>;
  /** The file-level metrics, like `max-lines`. */
  metrics: Record<string, number>;
  functions: ReportFunction[];
}

/** How a metric spreads over every function (or file): the median, the 90th percentile, the largest. */
export interface Distribution {
  metric: string;
  count: number;
  p50: number;
  p90: number;
  max: number;
}

export interface WorstEntry {
  file: string;
  key: string;
  line: number;
  value: number;
  threshold: number | null;
}

/** A baseline entry with the values the code has now (none when it is gone). */
export interface ReportBaselineEntry {
  file: string;
  key: string;
  metric: string;
  baseline: number[];
  current: number[];
}

/** The quality report, `.quality/report.json`. Its shape changes only with a new version. */
export interface QualityReport {
  version: 1;
  generatedAt: string;
  passed: boolean;
  summary: {
    files: number;
    functions: number;
    failures: number;
    newClones: number;
    staleClones: number;
    importViolations: number;
    knownOffenders: number;
    knownClones: number;
  };
  /** The metrics measured on every function, then those measured on every file. */
  functionMetrics: string[];
  fileMetrics: string[];
  distributions: Distribution[];
  /** Per metric, the 20 largest values. */
  worst: { metric: string; entries: WorstEntry[] }[];
  files: ReportFile[];
  failures: Failure[];
  baseline: ReportBaselineEntry[];
  clones: Clone[];
  importViolations: ImportViolation[];
}
