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
 * turns it off with the reason beside it.
 */
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { readBiomeRuleLevels } from './read-biome-rule-levels';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

const BIOME_CONFIG = z.object({ $schema: z.string() });

describe('biome.jsonc', { timeout: PROCESS_BUDGET_MS }, () => {
  it('names the schema of the Biome the project installs', () => {
    const { config, error } = ts.readConfigFile(path.join(ROOT, 'biome.jsonc'), ts.sys.readFile);
    expect(error).toBeUndefined();
    const { $schema } = BIOME_CONFIG.parse(config);
    const named = path.join(ROOT, $schema);
    const installed = require.resolve('@biomejs/biome/configuration_schema.json');
    expect(existsSync(named) ? realpathSync(named) : $schema).toBe(installed);
  });

  it('makes every rule it enables an error, so that any finding fails pnpm check', async () => {
    const levels = await readBiomeRuleLevels(ROOT);
    const below = [...levels]
      .filter(([, level]) => level !== 'error')
      .map(([rule, level]) => `${rule} (${level})`);
    expect(levels.size).toBeGreaterThan(0);
    expect(below, 'set these to "error" in biome.jsonc, or "off" with the reason').toEqual([]);
  });
});
