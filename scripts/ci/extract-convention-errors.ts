/**
 * The violations `pnpm check:conventions` lists under "Convention violations:", one per indented
 * line: `file: problem`, `file:line: problem`, or a problem of the whole code base.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const PLACED = /^(\S+?\.\w+)(?::(\d+))?: (.*)$/;

export function extractConventionErrors(log: string): StepFailure[] {
  const failures: StepFailure[] = [];
  let inList = false;
  for (const line of log.split('\n')) {
    if (line === 'Convention violations:') {
      inList = true;
    } else if (inList && line.startsWith('  ')) {
      const text = line.trim();
      const placed = PLACED.exec(text);
      failures.push(
        placed
          ? makeFailure({
              tool: 'conventions',
              message: placed[3] ?? '',
              file: placed[1] ?? null,
              line: placed[2] === undefined ? null : Number(placed[2]),
            })
          : makeFailure({ tool: 'conventions', message: text }),
      );
    } else {
      inList = false;
    }
  }
  return failures;
}
