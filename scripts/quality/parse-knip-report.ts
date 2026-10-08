/**
 * Reads the JSON report knip writes (`--reporter json`) into findings the quality baseline knows:
 * one per file, name and kind of issue, with the value 1 (an export is unused or it is not). An
 * unused file is named `file`, like a file-level metric; an enum or namespace member by its parent
 * (`Mode.Off`); a duplicate export by all its names (`start = begin`); a dependency by its package,
 * on package.json. An issue type this list does not name yet keeps knip's own name rather than
 * being dropped, so a new knip version cannot hide findings. Paths come relative to the root.
 */
import { z } from 'zod';
import type { Finding } from './types';

const ITEM = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  line: z.number().int().optional(),
});
const LIST = z.array(ITEM);
const GROUPS = z.array(z.array(ITEM));
const REPORT = z.object({ issues: z.array(z.looseObject({ file: z.string() })) });

/** knip's issue types, as the measures the baseline and the summary name. */
const METRICS: Record<string, string> = {
  files: 'unused-file',
  dependencies: 'unused-dependency',
  devDependencies: 'unused-dev-dependency',
  optionalPeerDependencies: 'unused-optional-peer-dependency',
  unlisted: 'unlisted-dependency',
  binaries: 'unlisted-binary',
  unresolved: 'unresolved-import',
  exports: 'unused-export',
  nsExports: 'unused-namespace-export',
  types: 'unused-type',
  nsTypes: 'unused-namespace-type',
  enumMembers: 'unused-enum-member',
  namespaceMembers: 'unused-namespace-member',
  duplicates: 'duplicate-export',
  catalog: 'unused-catalog-entry',
  catalogReferences: 'unresolved-catalog-reference',
};

/** Row fields that are not issues: the file itself, and its owners when the repository has a CODEOWNERS file. */
const NOT_ISSUES = new Set(['file', 'owners']);

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`the knip report has an unexpected shape: ${result.error.message}`);
  }
  return result.data;
}

function finding(file: string, metric: string, key: string, line = 0): Finding {
  return { file, line, key, metric, value: 1, threshold: null };
}

function findingsOf(file: string, type: string, value: unknown): Finding[] {
  const metric = METRICS[type] ?? type;
  if (type === 'duplicates') {
    return parsed(GROUPS, value).map((names) =>
      finding(file, metric, names.map((item) => item.name).join(' = ')),
    );
  }
  return parsed(LIST, value).map((item) => {
    if (type === 'files') return finding(file, metric, 'file');
    const key = item.namespace === undefined ? item.name : `${item.namespace}.${item.name}`;
    return finding(file, metric, key, item.line);
  });
}

export function parseKnipReport(text: string): Finding[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`the knip report is not JSON: ${String(error)}`);
  }
  return parsed(REPORT, data).issues.flatMap((row) =>
    Object.entries(row)
      .filter(([type]) => !NOT_ISSUES.has(type))
      .flatMap(([type, value]) => findingsOf(row.file, type, value)),
  );
}
