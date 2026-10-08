/**
 * Turns ESLint's results into findings: each metric message becomes a value on the function (or
 * file) it belongs to, named from the file's syntax tree. A message of any other rule (SonarJS's
 * code smells and security hotspots) is a yes-or-no finding there, named after its rule, with the
 * value 1. eslint.config.js makes ESLint ignore inline comments (`// eslint-disable-next-line`),
 * so that the baseline stays the only way to accept a finding; ESLint warns about each one, and
 * that warning is a yes-or-no finding too (`no-inline-config`), so an ignored comment is removed
 * rather than read as working. A file ESLint could not parse fails the run: a broken file must not
 * pass as clean.
 */
import { nameFunction } from './name-function';
import { parseMetricMessage } from './parse-metric-message';
import { relativeToRoot } from './relative-to-root';
import type { Finding } from './types';

/** ESLint's warning for an inline comment it ignores under `linterOptions.noInlineConfig`. */
const IGNORED_INLINE_CONFIG = /has no effect because you have 'noInlineConfig' setting/;
const INLINE_CONFIG_HIT = { metric: 'no-inline-config', value: 1, threshold: null };

export interface LintMessage {
  ruleId: string | null;
  message: string;
  line: number;
  column: number;
  fatal?: boolean | undefined;
}

export interface LintFileResult {
  filePath: string;
  messages: LintMessage[];
  source?: string | undefined;
}

export interface CollectDeps {
  root: string;
  readSource: (filePath: string) => Promise<string>;
}

export async function collectEslintFindings(
  results: LintFileResult[],
  deps: CollectDeps,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const result of results) {
    const file = relativeToRoot(result.filePath, deps.root);
    const fatal = result.messages.find((message) => message.fatal === true);
    if (fatal !== undefined) {
      throw new Error(`${file}:${fatal.line}:${fatal.column} ${fatal.message}`);
    }
    const hits = result.messages.flatMap((message) => {
      if (message.ruleId === null) {
        return IGNORED_INLINE_CONFIG.test(message.message)
          ? [{ message, hit: INLINE_CONFIG_HIT }]
          : [];
      }
      const hit = parseMetricMessage(message.ruleId, message.message) ?? {
        metric: message.ruleId.replace(/^sonarjs\//, ''),
        value: 1,
        threshold: null,
      };
      return [{ message, hit }];
    });
    if (hits.length === 0) continue;
    const source = result.source ?? (await deps.readSource(result.filePath));
    for (const { message, hit } of hits) {
      findings.push({
        file,
        line: message.line,
        key: nameFunction(file, source, message.line, message.column),
        metric: hit.metric,
        value: hit.value,
        threshold: hit.threshold,
      });
    }
  }
  return findings;
}
