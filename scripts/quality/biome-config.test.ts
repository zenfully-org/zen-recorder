// @vitest-environment node
/**
 * Keeps biome.jsonc in step with the Biome the project installs. A `$schema` that names a release
 * (`https://biomejs.dev/schemas/<version>/schema.json`) goes stale at the next update, and Biome
 * then prints a note on every `pnpm check` until someone moves it; the installed package's own
 * schema is always the one its CLI reads.
 *
 * Biome fails a check only on an error. A rule it reports as a warning or an info prints its
 * finding and the check passes, so every rule biome.jsonc enables is an error: a rule that comes
 * with a Biome update at a lower level of its own fails this test until biome.jsonc raises it, or
 * turns it off with the reason beside it. That includes the rules of a domain (react, test, ...),
 * which Biome turns on for the domains biome.jsonc names and for the packages package.json
 * declares. Which rules a domain holds, and each rule's own level, come from biome-rules.json,
 * which `pnpm quality:biome-rules` writes from the installed Biome.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { listBiomeRuleNames } from './list-biome-rule-names';
import { readBiomeRuleLevels } from './read-biome-rule-levels';
import { readBiomeRules } from './read-biome-rules';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

const BIOME_CONFIG = z.object({
  $schema: z.string(),
  linter: z.object({ domains: z.record(z.string(), z.string()).optional() }),
});
const PACKAGE = z.object({ version: z.string() });
const DEPENDENCIES = z.record(z.string(), z.string()).optional();
/** The fields Biome reads to turn a domain on (measured: not `optionalDependencies`). */
const MANIFEST = z.object({
  dependencies: DEPENDENCIES,
  devDependencies: DEPENDENCIES,
  peerDependencies: DEPENDENCIES,
});

function readBiomeConfig(): z.infer<typeof BIOME_CONFIG> {
  const { config, error } = ts.readConfigFile(path.join(ROOT, 'biome.jsonc'), ts.sys.readFile);
  expect(error).toBeUndefined();
  return BIOME_CONFIG.parse(config);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** `react` from `react@>=16.0.0`, `@scope/name` from `@scope/name@>=1.0.0`. */
function packageOf(dependency: string): string {
  const at = dependency.indexOf('@', 1);
  return at < 0 ? dependency : dependency.slice(0, at);
}

const RDJSON = z.object({
  diagnostics: z.array(
    z.object({
      code: z.object({ value: z.string() }),
      location: z.object({ path: z.string() }),
      severity: z.string(),
    }),
  ),
});

/**
 * What Biome reports for `files` (path → source) placed in a copy of this repository's
 * configuration: `path → rule → severity`. The copy keeps the repository's working tree out of it.
 */
function lintProbes(files: Record<string, string>): Record<string, Record<string, string>> {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-biome-probe-')));
  try {
    copyFileSync(path.join(ROOT, 'biome.jsonc'), path.join(folder, 'biome.jsonc'));
    copyFileSync(path.join(ROOT, 'package.json'), path.join(folder, 'package.json'));
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      writeFileSync(path.join(folder, file), source);
    }
    const biome = require.resolve('@biomejs/biome/bin/biome');
    const { stdout, stderr } = spawnSync(
      process.execPath,
      [biome, 'lint', '--vcs-enabled=false', '--reporter=rdjson', '--max-diagnostics=none', '.'],
      { cwd: folder, encoding: 'utf8' },
    );
    if (!stdout) throw new Error(`biome lint printed no report: ${stderr}`);
    const reported: Record<string, Record<string, string>> = {};
    for (const { code, location, severity } of RDJSON.parse(JSON.parse(stdout)).diagnostics) {
      const file = location.path.replaceAll('\\', '/');
      reported[file] = { ...reported[file], [code.value]: severity };
    }
    return reported;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('biome.jsonc', { timeout: PROCESS_BUDGET_MS }, () => {
  it('names the schema of the Biome the project installs', () => {
    const { $schema } = readBiomeConfig();
    const named = path.join(ROOT, $schema);
    const installed = require.resolve('@biomejs/biome/configuration_schema.json');
    expect(existsSync(named) ? realpathSync(named) : $schema).toBe(installed);
  });

  it('is read with the rules of the Biome the project installs (biome-rules.json)', () => {
    const { version } = PACKAGE.parse(require('@biomejs/biome/package.json'));
    const rules = readBiomeRules();
    expect(
      rules.biome,
      `biome-rules.json holds Biome ${rules.biome}'s rules and ${version} is installed: run pnpm quality:biome-rules and read its diff for new domain rules and levels`,
    ).toBe(version);
    const schema = readJson(require.resolve('@biomejs/biome/configuration_schema.json'));
    expect(Object.keys(rules.levels)).toEqual(listBiomeRuleNames(schema));
  });

  it('names every domain the packages of package.json turn on, so this test reads its rules', () => {
    const manifest = MANIFEST.parse(readJson(path.join(ROOT, 'package.json')));
    const declared = new Set(
      Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      }),
    );
    const named = Object.keys(readBiomeConfig().linter.domains ?? {});
    const unnamed = Object.entries(readBiomeRules().domains)
      .filter(([, domain]) => domain.dependencies.some((d) => declared.has(packageOf(d))))
      .map(([name]) => name)
      .filter((name) => !named.includes(name));
    expect(unnamed, 'name these in linter.domains of biome.jsonc').toEqual([]);
  });

  it('makes every rule it enables an error, so that any finding fails pnpm check', () => {
    const levels = readBiomeRuleLevels(ROOT, readBiomeRules());
    const below = [...levels]
      .filter(([, level]) => level !== 'error')
      .map(([rule, level]) => `${rule} (${level})`);
    expect(levels.get('suspicious/noExportsInTest'), 'the test domain is read').toBeDefined();
    expect(levels.get('correctness/noChildrenProp'), 'the react domain is read').toBeDefined();
    expect(below, 'set these to "error" in biome.jsonc, or "off" with the reason').toEqual([]);
  });

  it('keeps noComponentHookFactories an error in the React code, off only where test doubles are', () => {
    const factory =
      'export function make() {\n  function Probe() {\n    return null;\n  }\n  return Probe;\n}\n';
    const reported = lintProbes({
      'src/components/probe.tsx': factory,
      'src/entrypoints/popup/probe.tsx': factory,
      'src/lib/probe.ts': factory,
      'src/test/fakes/probe.ts': factory,
    });
    const rule = 'lint/correctness/noComponentHookFactories';
    expect({
      components: reported['src/components/probe.tsx']?.[rule],
      entrypoints: reported['src/entrypoints/popup/probe.tsx']?.[rule],
      lib: reported['src/lib/probe.ts']?.[rule],
      fakes: reported['src/test/fakes/probe.ts']?.[rule],
    }).toEqual({ components: 'ERROR', entrypoints: 'ERROR', lib: undefined, fakes: undefined });
  });
});
