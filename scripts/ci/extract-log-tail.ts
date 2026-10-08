/**
 * The end of a failed step's log, for a tool the report cannot read: what a command printed last
 * usually says why it stopped. Colours and GitHub's workflow commands are left out.
 */
import { stripVTControlCharacters } from 'node:util';
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const LINES = 20;

export function extractLogTail(log: string): StepFailure[] {
  const lines = stripVTControlCharacters(log)
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('::'))
    .slice(-LINES);
  return lines.length === 0 ? [] : [makeFailure({ tool: 'log', message: lines.join('\n') })];
}
