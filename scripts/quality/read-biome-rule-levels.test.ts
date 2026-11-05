// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { readBiomeRuleLevels } from './read-biome-rule-levels';
import type { BiomeRules } from './read-biome-rules';

/** The part of Biome's rule catalog these cases read, with each rule's own default level. */
const RULES: BiomeRules = {
  biome: '2.6.3',
  levels: {
    'correctness/noUnusedVariables': 'warn',
    'style/useConst': 'warn',
    'style/useTemplate': 'info',
    'suspicious/noConsole': 'warn',
    'suspicious/noDebugger': 'error',
    'suspicious/noDrizzleDeleteWithoutWhere': 'error',
    'suspicious/noDrizzleUpdateWithoutWhere': 'error',
    'suspicious/noExportsInTest': 'error',
    'suspicious/noFocusedTests': 'warn',
    'suspicious/noIdenticalTestTitle': 'warn',
    'suspicious/noSkippedTests': 'warn',
  },
  domains: {
    drizzle: {
      dependencies: ['drizzle-orm@>=0.9.0'],
      recommended: ['suspicious/noDrizzleDeleteWithoutWhere'],
      others: ['suspicious/noDrizzleUpdateWithoutWhere'],
    },
    solid: { dependencies: ['solid-js@>=1.0.0'], recommended: [], others: [] },
    test: {
      dependencies: ['vitest@>=1.0.0'],
      recommended: [
        'suspicious/noExportsInTest',
        'suspicious/noFocusedTests',
        'suspicious/noIdenticalTestTitle',
      ],
      others: ['suspicious/noSkippedTests'],
    },
  },
};

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-biome-levels-')));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function configure(text: string): void {
  writeFileSync(path.join(folder, 'biome.jsonc'), text);
}

describe('readBiomeRuleLevels', { timeout: PROCESS_BUDGET_MS }, () => {
  it('gives each enabled rule the level the configuration names, or else its own default', () => {
    configure(`{
      "linter": {
        "rules": {
          "preset": "none",
          "correctness": { "noUnusedVariables": { "level": "warn", "options": {} } },
          // Biome reports useTemplate as an info and noDebugger as an error unless told otherwise.
          "style": { "recommended": false, "useConst": "error", "useTemplate": "on" },
          "suspicious": { "noDebugger": "on", "noConsole": "off" },
        },
      },
    }`);
    expect(readBiomeRuleLevels(folder, RULES)).toEqual(
      new Map([
        ['correctness/noUnusedVariables', 'warn'],
        ['style/useConst', 'error'],
        ['style/useTemplate', 'info'],
        ['suspicious/noDebugger', 'error'],
      ]),
    );
  });

  // `biome rage` lists the rules of a domain named "all" itself, and none of one named
  // "recommended" or turned on by a package.
  it('adds the rules each domain the configuration names turns on, except those it turns off', () => {
    configure(`{
      "linter": {
        "rules": {
          "preset": "none",
          "suspicious": { "noFocusedTests": "error", "noExportsInTest": "off" },
        },
        "domains": { "test": "recommended", "drizzle": "all", "solid": "none" },
      },
    }`);
    expect(readBiomeRuleLevels(folder, RULES)).toEqual(
      new Map([
        ['suspicious/noDrizzleDeleteWithoutWhere', 'error'],
        ['suspicious/noDrizzleUpdateWithoutWhere', 'error'],
        ['suspicious/noFocusedTests', 'error'],
        ['suspicious/noIdenticalTestTitle', 'warn'],
      ]),
    );
  });

  it('gives a rule an override names the lower of its two levels, and turns one on there', () => {
    configure(`{
      "linter": { "rules": { "preset": "none", "style": { "useConst": "error" } } },
      "overrides": [
        { "includes": ["scripts/**"], "linter": { "rules": { "style": { "useConst": "warn" } } } },
        {
          "includes": ["src/**"],
          "linter": { "rules": { "style": { "useConst": "off" }, "suspicious": { "noConsole": "on" } } },
        },
      ],
    }`);
    expect(readBiomeRuleLevels(folder, RULES)).toEqual(
      new Map([
        ['style/useConst', 'warn'],
        ['suspicious/noConsole', 'warn'],
      ]),
    );
  });

  it.each([
    ['unreadable', '{ "linter": { "rules": { "style": [ } } }', /biome\.jsonc/],
    [
      'an override that names domains',
      '{ "overrides": [{ "linter": { "domains": { "test": "all" } } }] }',
      /domains/,
    ],
    [
      'an override with a preset',
      '{ "overrides": [{ "linter": { "rules": { "preset": "all" } } }] }',
      /preset/,
    ],
    ['a domain the catalog does not know', '{ "linter": { "domains": { "vue": "all" } } }', /vue/],
    [
      'a rule the catalog does not know',
      '{ "linter": { "rules": { "preset": "none", "style": { "useBlockStatements": "on" } } } }',
      /useBlockStatements/,
    ],
  ])('refuses a configuration with %s, rather than guess its levels', (_, text, error) => {
    configure(text);
    expect(() => readBiomeRuleLevels(folder, RULES)).toThrow(error);
  });
});
