/**
 * Enforces the repo conventions:
 *   - every module in src/lib exports exactly one function (types/interfaces are fine),
 *   - every module in src/lib has a same-named `.test.ts` next to it,
 *   - no classes in src/lib,
 *   - no forced types: no `value as X` (except `as const`), no `<X>value`, no non-null `!`, no
 *     `any`, no `@ts-expect-error` / `@ts-expect-error` / `@ts-nocheck`. Production code must have none;
 *     test code (tests and test doubles) still has legacy ones, counted against a baseline that
 *     may only go down,
 *   - every TypeScript file git tracks is type-checked: tsconfig.json lists the folders it checks,
 *     so a tracked file outside them would otherwise escape `tsc` without a word.
 * Exempt from the src/lib rules: `src/lib/types.ts` (types only).
 * It reads the files git tracks or would add: staged and untracked ones count, a file in a folder
 * git ignores (a scratch folder, `.git/info/exclude`) does not, and a module's test must be one of
 * them too.
 * Usage: `pnpm check:conventions` (part of `pnpm check`).
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { listProjectFiles } from './git-files';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIB = path.join(ROOT, 'src/lib');
const EXEMPT = new Set(['types.ts', 'providers/types.ts']);
/** Directories (and root files) whose code must be free of forced types. */
const PRODUCTION_ROOTS = ['src/lib', 'src/entrypoints', 'src/wiring', 'scripts'];
const PRODUCTION_FILES = ['wxt.config.ts', 'vitest.config.ts'];
const TEST_ROOTS = ['src'];
/**
 * Forced types left in tests and test doubles (mostly fakes cast to browser interfaces). Lower
 * this number whenever some are removed; it must never go up.
 */
const LEGACY_TEST_ASSERTIONS = 144;

const SOURCE_RE = /\.tsx?$/;
const TEST_FILE_RE = /\.test\.tsx?$/;
const DIRECTIVE_RE = /^\s*\/[/*]\s*@ts-(?:ignore|expect-error|nocheck)\b/gm;

/** The TypeScript files under `dirs` that git tracks or would add, as absolute paths. */
function listSources(dirs: string[]): string[] {
  return listProjectFiles(ROOT, dirs)
    .filter((file) => SOURCE_RE.test(file))
    .map((file) => path.join(ROOT, file));
}

function isTestCode(file: string): boolean {
  const rel = path.relative(ROOT, file);
  return TEST_FILE_RE.test(rel) || rel.startsWith(path.join('src', 'test') + path.sep);
}

function countExportedFunctions(source: string): number {
  const named = source.match(/^export (?:async )?function\b/gm)?.length ?? 0;
  const consts =
    source.match(/^export const \w+\s*=\s*(?:async\s*)?(?:\(|function\b)/gm)?.length ?? 0;
  return named + consts;
}

interface ForcedType {
  line: number;
  what: string;
}

function describeNode(node: ts.Node): string | null {
  if (ts.isAsExpression(node)) {
    return ts.isConstTypeReference(node.type) ? null : `type assertion "as ${node.type.getText()}"`;
  }
  if (ts.isTypeAssertionExpression(node)) return `type assertion "<${node.type.getText()}>"`;
  if (ts.isNonNullExpression(node)) return 'non-null assertion "!"';
  if (node.kind === ts.SyntaxKind.AnyKeyword) return '"any"';
  return null;
}

function findForcedTypes(file: string, source: string): ForcedType[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (position: number) => tree.getLineAndCharacterOfPosition(position).line + 1;
  const found: ForcedType[] = [];
  const visit = (node: ts.Node): void => {
    const what = describeNode(node);
    if (what) found.push({ line: lineOf(node.getStart(tree)), what });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const match of source.matchAll(DIRECTIVE_RE)) {
    found.push({ line: lineOf(match.index), what: `directive "${match[0]}"` });
  }
  return found;
}

async function checkLibModules(): Promise<string[]> {
  const listed = new Set(listSources([path.relative(ROOT, LIB)]));
  const files = [...listed].filter((file) => !TEST_FILE_RE.test(file));
  const perFile = await Promise.all(
    files.map(async (file) => {
      // `/` on every system: EXEMPT names the files as git does.
      if (EXEMPT.has(path.relative(LIB, file).split(path.sep).join('/'))) return [];
      // Relative to the repository's root, like every other path the checks print.
      const rel = path.relative(ROOT, file);
      const source = await readFile(file, 'utf8');
      const exported = countExportedFunctions(source);
      const test = file.replace(/\.ts$/, '.test.ts');
      return [
        ...(exported !== 1 ? [`${rel}: exports ${exported} functions (expected exactly 1)`] : []),
        ...(/^\s*(export )?class\b/m.test(source) ? [`${rel}: uses a class`] : []),
        ...(listed.has(test) ? [] : [`${rel}: missing ${path.basename(test)}`]),
      ];
    }),
  );
  return perFile.flat();
}

async function scanForcedTypes(files: string[]): Promise<string[]> {
  const perFile = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, 'utf8');
      return findForcedTypes(file, source).map(
        (hit) => `${path.relative(ROOT, file)}:${hit.line}: ${hit.what}`,
      );
    }),
  );
  return perFile.flat();
}

/**
 * Tracked TypeScript files that `tsc` does not check. tsconfig.json includes the project's folders
 * instead of excluding what a working copy may hold besides them (scratch files, clones of other
 * projects), which no tracked config can name.
 */
function findUncheckedTypeScript(): string[] {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const checked = new Set(
    ts.parseJsonConfigFileContent(config, ts.sys, ROOT).fileNames.map((file) => path.resolve(file)),
  );
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.tsx', '*.mts', '*.cts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return tracked
    .split('\0')
    .filter((file) => file !== '' && !checked.has(path.resolve(ROOT, file)))
    .map((file) => `${file}: not type-checked (add its folder to "include" in tsconfig.json)`);
}

async function main(): Promise<void> {
  const productionFiles = [
    ...listSources(PRODUCTION_ROOTS),
    ...PRODUCTION_FILES.map((file) => path.join(ROOT, file)),
  ].filter((file) => !isTestCode(file));
  const testFiles = listSources(TEST_ROOTS).filter(isTestCode);

  const forcedInProduction = await scanForcedTypes(productionFiles);
  const forcedInTests = await scanForcedTypes(testFiles);
  const problems = [
    ...(await checkLibModules()),
    ...findUncheckedTypeScript(),
    ...forcedInProduction.map((hit) => `${hit} (forcing a type is not allowed)`),
  ];
  if (forcedInTests.length > LEGACY_TEST_ASSERTIONS) {
    problems.push(
      `test code has ${forcedInTests.length} forced types, baseline is ${LEGACY_TEST_ASSERTIONS}: ` +
        'new test code must not force types (run with --list-test-assertions to see them)',
    );
  } else if (forcedInTests.length < LEGACY_TEST_ASSERTIONS) {
    problems.push(
      `test code is down to ${forcedInTests.length} forced types: lower LEGACY_TEST_ASSERTIONS ` +
        'in scripts/check-conventions.ts to that number',
    );
  }
  if (process.argv.includes('--list-test-assertions')) console.log(forcedInTests.join('\n'));
  if (problems.length > 0) {
    console.error(`Convention violations:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    'conventions ok: one exported function per module, a test per module, no classes, ' +
      `no forced types (${forcedInTests.length} legacy ones left in test code), ` +
      'every tracked TypeScript file type-checked',
  );
}

void main();
