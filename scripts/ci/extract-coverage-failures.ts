/**
 * What `pnpm test:coverage` found uncovered. Vitest prints one line per measure below its
 * threshold (`ERROR: Coverage for branches (99.8%) does not meet global threshold (100%)`), and
 * its table cuts long file names; so the files and lines come from `.coverage/coverage-final.json`
 * (Istanbul's format, Vitest's `json` reporter): every statement, function and branch that never
 * ran, by file.
 */
import { z } from 'zod';
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const THRESHOLD =
  /^ERROR: Coverage for (\w+) \(([\d.]+)%\) does not meet (?:global|".*?") threshold \(([\d.]+)%\)/;
/** A file left mostly uncovered would list every line; the first ranges say where to look. */
const MAX_RANGES = 10;

const RANGE = z.object({ start: z.object({ line: z.number() }) });
const COVERAGE = z.record(
  z.string(),
  z.object({
    statementMap: z.record(z.string(), RANGE),
    fnMap: z.record(z.string(), z.object({ decl: RANGE })),
    // A branch the code does not write (an `if` without `else`) has no place of its own: its
    // `if` is on `line`.
    branchMap: z.record(
      z.string(),
      z.object({
        line: z.number(),
        locations: z.array(z.object({ start: z.object({ line: z.number().optional() }) })),
      }),
    ),
    s: z.record(z.string(), z.number()),
    f: z.record(z.string(), z.number()),
    b: z.record(z.string(), z.array(z.number())),
  }),
);
type FileCoverage = z.infer<typeof COVERAGE>[string];

/** `1-3, 7, 9-10` for lines 1, 2, 3, 7, 9 and 10. */
function describeLines(lines: number[]): string {
  const ranges: [number, number][] = [];
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  const shown = ranges
    .slice(0, MAX_RANGES)
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`));
  return ranges.length > MAX_RANGES ? `${shown.join(', ')}, …` : shown.join(', ');
}

const count = (n: number, noun: string, plural: string) =>
  n === 0 ? [] : [`${n} ${n === 1 ? noun : plural}`];

function describeFile(file: string, coverage: FileCoverage): StepFailure | null {
  const statements = Object.entries(coverage.s).filter(([, hits]) => hits === 0);
  const functions = Object.entries(coverage.f).filter(([, hits]) => hits === 0);
  const branches = Object.entries(coverage.b).flatMap(([id, hits]) => {
    const branch = coverage.branchMap[id];
    return hits.flatMap((hit, index) =>
      hit === 0 ? [branch?.locations[index]?.start.line ?? branch?.line] : [],
    );
  });
  const lines = [
    ...statements.map(([id]) => coverage.statementMap[id]?.start.line),
    ...functions.map(([id]) => coverage.fnMap[id]?.decl.start.line),
    ...branches,
  ].filter((line) => line !== undefined);
  if (lines.length === 0) return null;
  const what = [
    ...count(statements.length, 'statement', 'statements'),
    ...count(branches.length, 'branch', 'branches'),
    ...count(functions.length, 'function', 'functions'),
  ];
  return makeFailure({
    tool: 'coverage',
    message: `not covered: lines ${describeLines(lines)} (${what.join(', ')})`,
    file,
    line: Math.min(...lines),
  });
}

export function extractCoverageFailures(
  log: string,
  readCoverage: () => string | null,
  root: string,
): StepFailure[] {
  const missed = log.split('\n').flatMap((line) => {
    const match = THRESHOLD.exec(line);
    if (!match) return [];
    const [, measure = '', covered = '', required = ''] = match;
    return [
      makeFailure({
        tool: 'coverage',
        message: `${measure}: ${covered} % covered, ${required} % required`,
        rule: measure,
      }),
    ];
  });
  if (missed.length === 0) return [];
  const text = readCoverage();
  if (text === null) return missed;
  const files = Object.entries(COVERAGE.parse(JSON.parse(text))).flatMap(([file, coverage]) => {
    const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    return describeFile(relative, coverage) ?? [];
  });
  return [...missed, ...files];
}
