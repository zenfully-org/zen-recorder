/**
 * The failures of the quality gates' summary (`pnpm check:quality`, `scripts/quality/format-summary.ts`):
 * after "Quality gates: N failures", one indented line per failure, `place  function  metric  verdict`,
 * then the new duplicated blocks, `N lines  first  second`, then the broken import rules,
 * `rule  chain`. The fields are separated by two spaces.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

type Section = 'failures' | 'clones' | 'imports' | null;

const PLACE = /^(.+?)(?::(\d+))?$/;

function place(text: string): { file: string | null; line: number | null } {
  const match = PLACE.exec(text);
  return { file: match?.[1] ?? null, line: match?.[2] === undefined ? null : Number(match[2]) };
}

function read(section: Section, fields: string[]): StepFailure {
  const [first = '', second = '', third = '', fourth = ''] = fields;
  if (section === 'failures' && fields.length === 4) {
    return makeFailure({
      tool: 'quality',
      message: `${second}: ${third}, ${fourth}`,
      ...place(first),
      rule: third.split(' ')[0] ?? null,
    });
  }
  if (section === 'clones' && fields.length === 3) {
    return makeFailure({
      tool: 'quality',
      message: `${first} repeat ${third}`,
      ...place(second),
      rule: 'duplicated-block',
    });
  }
  if (section === 'imports' && fields.length === 2) {
    return makeFailure({
      tool: 'quality',
      message: second,
      file: second.split(' → ')[0] ?? null,
      rule: first,
    });
  }
  return makeFailure({ tool: 'quality', message: fields.join('  ') });
}

function sectionOf(line: string): Section | undefined {
  if (/^Quality gates: \d+ failures?$/.test(line)) return 'failures';
  if (line.startsWith('Duplicated blocks:')) return 'clones';
  if (line.startsWith('Import rules ')) return 'imports';
  if (line.startsWith('Rules:')) return null;
  return undefined;
}

export function extractQualityFailures(log: string): StepFailure[] {
  const failures: StepFailure[] = [];
  let section: Section = null;
  for (const line of log.split('\n')) {
    const next = sectionOf(line);
    if (next !== undefined) section = next;
    else if (section && line.startsWith('  ')) {
      failures.push(read(section, line.trim().split(/ {2,}/)));
    }
  }
  return failures;
}
