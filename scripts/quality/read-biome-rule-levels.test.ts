// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { readBiomeRuleLevels } from './read-biome-rule-levels';

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-biome-levels-')));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('readBiomeRuleLevels', { timeout: PROCESS_BUDGET_MS }, () => {
  it('gives each enabled rule the level the configuration names, or else Biome its default', async () => {
    writeFileSync(
      path.join(folder, 'biome.jsonc'),
      `{
        "linter": {
          "rules": {
            "preset": "none",
            "correctness": { "noUnusedVariables": { "level": "warn", "options": {} } },
            // Biome reports useTemplate as an info and noDebugger as an error unless told otherwise.
            "style": { "recommended": false, "useConst": "error", "useTemplate": "on" },
            "suspicious": { "noDebugger": "on", "noConsole": "off" },
          },
        },
      }`,
    );
    expect(await readBiomeRuleLevels(folder)).toEqual(
      new Map([
        ['correctness/noUnusedVariables', 'warn'],
        ['style/useConst', 'error'],
        ['style/useTemplate', 'info'],
        ['suspicious/noDebugger', 'error'],
      ]),
    );
  });

  it('refuses a configuration it cannot read, rather than guess its levels', async () => {
    writeFileSync(path.join(folder, 'biome.jsonc'), '{ "linter": { "rules": { "style": [ } } }');
    await expect(readBiomeRuleLevels(folder)).rejects.toThrow(/biome\.jsonc/);
  });
});
