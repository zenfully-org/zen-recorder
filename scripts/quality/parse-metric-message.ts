/**
 * Reads the measured value and the threshold out of an ESLint message of one of the metric rules
 * the quality gate runs. SonarJS rules say the number but not the function ("Refactor this
 * function to reduce its Cognitive Complexity from 21 to the 15 allowed."); ESLint's own rules
 * name the function too. A rule that only says yes or no (nested control flow, identical
 * functions) counts as 1. A rule the gate does not run gives null; a known rule whose wording
 * changed throws, so a plugin upgrade cannot hide offenders behind an unreadable message.
 */
import { z } from 'zod';

export interface MetricHit {
  metric: string;
  value: number;
  threshold: number | null;
}

const PATTERNS: Record<string, RegExp> = {
  'sonarjs/cognitive-complexity':
    /Cognitive Complexity from (?<value>\d+) to the (?<threshold>\d+) allowed/,
  'sonarjs/cyclomatic-complexity':
    /complexity of (?<value>\d+) which is greater than (?<threshold>\d+) authorized/,
  'sonarjs/max-lines-per-function':
    /has (?<value>\d+) lines, which is greater than the (?<threshold>\d+) lines authorized/,
  'sonarjs/max-lines':
    /has (?<value>\d+) lines, which is greater than (?<threshold>\d+) authorized/,
  'sonarjs/nested-control-flow': /not nest more than (?<threshold>\d+) /,
  'sonarjs/expression-complexity':
    /conditional operators \((?<value>\d+)\) used in the expression \(maximum allowed (?<threshold>\d+)\)/,
  'sonarjs/max-switch-cases': /switch cases from (?<value>\d+) to at most (?<threshold>\d+)/,
  'sonarjs/no-nested-functions': /not nest functions more than (?<threshold>\d+) levels/,
  'sonarjs/no-identical-functions': /not identical to the one on line \d+/,
  'sonarjs/no-duplicate-string': /duplicating this literal (?<value>\d+) times/,
  'max-params': /has too many parameters \((?<value>\d+)\)\. Maximum allowed is (?<threshold>\d+)/,
  'max-statements':
    /has too many statements \((?<value>\d+)\)\. Maximum allowed is (?<threshold>\d+)/,
  'max-nested-callbacks':
    /Too many nested callbacks \((?<value>\d+)\)\. Maximum allowed is (?<threshold>\d+)/,
};

/** SonarJS wraps a message in JSON when it carries secondary locations. */
const ENVELOPE = z.object({ message: z.string() });

function unwrap(message: string): string {
  if (!message.startsWith('{')) return message;
  try {
    const envelope = ENVELOPE.safeParse(JSON.parse(message));
    return envelope.success ? envelope.data.message : message;
  } catch {
    return message;
  }
}

function numberOf(group: string | undefined): number | null {
  return group === undefined ? null : Number(group);
}

export function parseMetricMessage(ruleId: string | null, message: string): MetricHit | null {
  if (ruleId === null) return null;
  const pattern = PATTERNS[ruleId];
  if (pattern === undefined) return null;
  const text = unwrap(message);
  const match = pattern.exec(text);
  if (match === null) {
    throw new Error(`cannot read the value in a message of ${ruleId}: "${text}"`);
  }
  const groups = match.groups ?? {};
  return {
    metric: ruleId.replace(/^sonarjs\//, ''),
    value: numberOf(groups['value']) ?? 1,
    threshold: numberOf(groups['threshold']),
  };
}
