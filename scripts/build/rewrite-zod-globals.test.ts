import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rewriteZodGlobals } from './rewrite-zod-globals';

const zodRoot = path.dirname(createRequire(import.meta.url).resolve('zod/package.json'));
const readZod = (file: string) => readFileSync(path.join(zodRoot, file), 'utf8');

describe('rewriteZodGlobals', () => {
  it('points every access to a zod global at the holder', () => {
    const code = [
      '(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});',
      'export const globalConfig = globalThis.__zod_globalConfig;',
      'const pp = globalThis.__zod_globalConfig?.postProcessor;',
      'const later = globalThis?.__zod_later;',
    ].join('\n');
    expect(rewriteZodGlobals(code, 'holder')).toBe(
      [
        '(_a = holder).__zod_globalConfig ?? (_a.__zod_globalConfig = {});',
        'export const globalConfig = holder.__zod_globalConfig;',
        'const pp = holder.__zod_globalConfig?.postProcessor;',
        'const later = holder?.__zod_later;',
      ].join('\n'),
    );
  });

  it('leaves the other uses of globalThis alone', () => {
    const code = 'const secure = globalThis.isSecureContext;\nconst g = globalThis;';
    expect(rewriteZodGlobals(code, 'holder')).toBeNull();
  });

  it('rewrites the zod release this project bundles: its core keeps its settings, its registries the global registry', () => {
    for (const file of ['v4/core/core.js', 'v4/core/registries.js']) {
      const rewritten = rewriteZodGlobals(readZod(file), 'holder');
      expect(rewritten, file).not.toBeNull();
      expect(rewritten, file).not.toMatch(/globalThis\W{0,4}__zod_/);
      expect(rewritten, file).toMatch(/holder\W{0,4}__zod_global(Config|Registry)/);
    }
  });
});
