/**
 * The slack as one GitHub Actions notice for the run (no file, so it does not repeat on every pull
 * request's diff): how many baseline entries and known clones could be lowered, the command that
 * lowers them, and the first entries. The run's output lists them all.
 */
import { escapeCommandData } from '../ci/escape-command-data';
import { describeFailure } from './describe-failure';
import type { Failure } from './types';

/** Enough to see what improved; the output of the gate has them all. */
const SHOWN = 20;

export function formatSlackNotice(slack: Failure[], goneClones: number): string | null {
  if (slack.length === 0 && goneClones === 0) return null;
  const counts = [
    ...(slack.length > 0
      ? [`${slack.length} baseline ${slack.length === 1 ? 'entry' : 'entries'}`]
      : []),
    ...(goneClones > 0 ? [`${goneClones} known clone${goneClones === 1 ? '' : 's'}`] : []),
  ];
  const lines = [
    `${counts.join(' and ')} could be lowered with pnpm check:quality --update-baseline; the scheduled "Tight baselines" check fails until they are.`,
    ...slack.slice(0, SHOWN).map((failure) => describeFailure(failure, { asSlack: true })),
    ...(slack.length > SHOWN
      ? [`… ${slack.length - SHOWN} more in the output of pnpm check:quality`]
      : []),
  ];
  return `::notice title=Quality baseline slack::${escapeCommandData(lines.join('\n'))}`;
}
