// @vitest-environment node
/**
 * Keeps the code-smell rules of eslint.config.js honest across upgrades of Biome, its
 * configuration and eslint-plugin-sonarjs: a SonarJS rule stays off only while Biome enforces the
 * same check, the lists of SonarJS's test rules and of its rules for one library match
 * SonarSource's own metadata, and no rule is both a smell rule and a metric rule or a Biome rule.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

const RULES = z.record(z.string(), z.unknown());
const CONFIG = z.object({
  default: z.array(z.object({ rules: RULES.optional() })),
  ENFORCED_BY_BIOME: z.record(z.string(), z.string()),
  REQUIRED_DEPENDENCIES: z.record(z.string(), z.array(z.string())),
  TEST_RULES: z.set(z.string()),
  smellRules: z.function({ input: [z.boolean()], output: RULES }),
});

let config: z.infer<typeof CONFIG>;

beforeAll(async () => {
  const url = pathToFileURL(path.join(ROOT, 'eslint.config.js')).href;
  config = CONFIG.parse(await import(url));
});

/** The Biome rules `biome rage --linter` lists as enabled for this repository, like `suspicious/noDebugger`. */
function enabledBiomeRules(): Set<string> {
  const biome = require.resolve('@biomejs/biome/bin/biome');
  const text = execFileSync(process.execPath, [biome, 'rage', '--linter'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const listed = text.slice(text.indexOf('Enabled rules:'));
  return new Set(listed.match(/^\s+[a-zA-Z0-9]+\/[a-zA-Z0-9]+$/gm)?.map((line) => line.trim()));
}

const META = z.object({
  eslintId: z.string(),
  scope: z.string(),
  requiredDependency: z.array(z.string()),
});

/** SonarSource's metadata of every SonarJS rule, read from the plugin's files (one folder per rule). */
function sonarMetadata(): z.infer<typeof META>[] {
  const dir = path.dirname(require.resolve('eslint-plugin-sonarjs'));
  return readdirSync(dir)
    .filter((entry) => /^S\d+$/.test(entry))
    .map((entry) => META.parse(require(path.join(dir, entry, 'generated-meta.js'))));
}

describe('eslint.config.js smell rules', () => {
  it('keeps a SonarJS rule off only while the Biome rule doing its check is enabled', () => {
    const enabled = enabledBiomeRules();
    const PLUGIN = z.object({ configs: z.object({ recommended: z.object({ rules: RULES }) }) });
    const plugin = PLUGIN.parse(require('eslint-plugin-sonarjs'));
    const recommended = Object.keys(plugin.configs.recommended.rules);
    for (const [sonar, biome] of Object.entries(config.ENFORCED_BY_BIOME)) {
      expect(recommended, `${sonar} is not a recommended SonarJS rule`).toContain(sonar);
      expect(enabled.has(biome), `Biome no longer enforces ${biome}: turn ${sonar} back on`).toBe(
        true,
      );
    }
  });

  it('lists exactly the rules SonarSource scopes to test code', () => {
    const tests = sonarMetadata().filter((meta) => meta.scope === 'Tests');
    expect([...config.TEST_RULES].sort()).toEqual(
      tests.map((meta) => `sonarjs/${meta.eslintId}`).sort(),
    );
  });

  it('lists exactly the rules SonarSource runs only for a library, with their packages', () => {
    const needing = sonarMetadata().filter((meta) => meta.requiredDependency.length > 0);
    expect(config.REQUIRED_DEPENDENCIES).toEqual(
      Object.fromEntries(
        needing.map((meta) => [`sonarjs/${meta.eslintId}`, meta.requiredDependency]),
      ),
    );
  });

  it('enables no smell rule that Biome enforces or that the metric rules configure', () => {
    const smells = [
      ...Object.keys(config.smellRules(false)),
      ...Object.keys(config.smellRules(true)),
    ];
    const metrics = Object.keys(config.default[1]?.rules ?? {});
    expect(metrics).toContain('sonarjs/cognitive-complexity');
    expect(smells.filter((rule) => rule in config.ENFORCED_BY_BIOME)).toEqual([]);
    expect(smells.filter((rule) => metrics.includes(rule))).toEqual([]);
  });

  it('gives main code and tests SonarJS rules of their own scope only', () => {
    const forMain = Object.keys(config.smellRules(false));
    const forTests = Object.keys(config.smellRules(true));
    expect(forMain).toContain('sonarjs/no-nested-conditional');
    expect(forTests).toContain('sonarjs/prefer-specific-assertions');
    expect(forMain.filter((rule) => config.TEST_RULES.has(rule))).toEqual([]);
    expect(forTests.filter((rule) => !config.TEST_RULES.has(rule))).toEqual([]);
  });
});
