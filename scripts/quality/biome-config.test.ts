// @vitest-environment node
/**
 * Keeps biome.json in step with the Biome the project installs. A `$schema` that names a release
 * (`https://biomejs.dev/schemas/<version>/schema.json`) goes stale at the next update, and Biome
 * then prints a note on every `pnpm check` until someone moves it; the installed package's own
 * schema is always the one its CLI reads.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

const BIOME_CONFIG = z.object({ $schema: z.string() });

describe('biome.json', () => {
  it('names the schema of the Biome the project installs', () => {
    const { $schema } = BIOME_CONFIG.parse(
      JSON.parse(readFileSync(path.join(ROOT, 'biome.json'), 'utf8')),
    );
    const named = path.join(ROOT, $schema);
    const installed = require.resolve('@biomejs/biome/configuration_schema.json');
    expect(existsSync(named) ? realpathSync(named) : $schema).toBe(installed);
  });
});
