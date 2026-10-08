/**
 * The errors of Biome's default report (`biome check`): each diagnostic opens with a header line,
 * `file:line:col rule ━━━`, or `file rule ━━━` for the whole file (a format error), and says what
 * is wrong on its first line marked `×` (an error); `!` marks a warning, which does not fail the
 * check and is left out.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const HEADER = /^(\S+?)(?::(\d+):(\d+))? (\S+)(?: {2}FIXABLE)? +━+$/;
const MARKED = /^ {2}([×!i]) (.*)$/;

const toNumber = (text: string | undefined): number | null =>
  text === undefined ? null : Number(text);

function toFailure(header: RegExpExecArray, message: string): StepFailure {
  const [, file = null, line, column, rule = null] = header;
  return makeFailure({
    tool: 'biome',
    message,
    file,
    line: toNumber(line),
    column: toNumber(column),
    rule,
  });
}

export function extractBiomeErrors(log: string): StepFailure[] {
  const failures: StepFailure[] = [];
  let header: RegExpExecArray | null = null;
  for (const line of log.split('\n')) {
    const marked = MARKED.exec(line);
    if (header && marked) {
      if (marked[1] === '×') failures.push(toFailure(header, marked[2] ?? ''));
      // Only a diagnostic's first marked line says what it is; the others explain or suggest.
      header = null;
    } else {
      header = HEADER.exec(line) ?? header;
    }
  }
  return failures;
}
