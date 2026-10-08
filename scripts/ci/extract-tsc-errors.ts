/**
 * The errors `tsc` printed without colours (its output in CI): `file(line,col): error TS1234:
 * message`, or `error TS1234: message` without a place, and the indented lines that explain it.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const ERROR = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

export function extractTscErrors(log: string): StepFailure[] {
  const failures: StepFailure[] = [];
  let current: StepFailure | null = null;
  for (const line of log.split('\n')) {
    const match = ERROR.exec(line);
    if (match) {
      current = makeFailure({
        tool: 'tsc',
        message: match[5] ?? '',
        file: match[1] ?? null,
        line: match[2] === undefined ? null : Number(match[2]),
        column: match[3] === undefined ? null : Number(match[3]),
        rule: match[4] ?? null,
      });
      failures.push(current);
    } else if (current && line.startsWith('  ')) {
      current.message = `${current.message}\n${line}`;
    } else {
      current = null;
    }
  }
  return failures;
}
