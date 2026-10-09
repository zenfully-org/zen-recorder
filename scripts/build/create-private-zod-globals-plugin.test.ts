// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { createPrivateZodGlobalsPlugin } from './create-private-zod-globals-plugin';

const zodEntry = path.join(
  path.dirname(createRequire(import.meta.url).resolve('zod/package.json')),
  'index.js',
);

/** What a hook script does with zod: interpreted mode, then schemas built and used later. */
const HOOK_LIKE_ENTRY = `
import { z } from ${JSON.stringify(zodEntry)};
z.config({ jitless: true });
export const config = z.config();
export const parses = () => z.object({ n: z.number() }).safeParse({ n: 1 }).success;
`;

function codeOf(result: Awaited<ReturnType<typeof build>>): string {
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) => ('output' in output ? output.output : []));
  return chunks.flatMap((file) => (file.type === 'chunk' ? [file.code] : [])).join('\n');
}

/** Bundles `entryCode` as the build bundles a content script: one minified script. */
async function bundle(entryCode: string, privateGlobals: boolean): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zod-globals-'));
  try {
    const entry = path.join(dir, 'entry.js');
    writeFileSync(entry, entryCode);
    return codeOf(
      await build({
        configFile: false,
        logLevel: 'silent',
        root: dir,
        plugins: privateGlobals ? [createPrivateZodGlobalsPlugin()] : [],
        build: { write: false, minify: true, lib: { entry, formats: ['iife'], name: 'hook' } },
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the bundle in a fresh global, standing for the meeting page's window, with what the page set. */
function runInPage(code: string, page: Record<string, unknown>) {
  const window = vm.createContext({ ...page });
  vm.runInContext(code, window);
  const hook = Reflect.get(window, 'hook');
  return {
    window,
    config: Reflect.get(hook, 'config'),
    parses: () => Reflect.apply(Reflect.get(hook, 'parses'), hook, []),
  };
}

describe('createPrivateZodGlobalsPlugin', () => {
  it("keeps zod's settings and registry off the page's window, and zod still works", async () => {
    const run = runInPage(await bundle(HOOK_LIKE_ENTRY, true), {});
    expect(run.parses()).toBe(true);
    expect(run.config).toMatchObject({ jitless: true });
    expect(Reflect.ownKeys(run.window).filter((key) => String(key).startsWith('__zod_'))).toEqual(
      [],
    );
  });

  it("gives the bundle's zod its own settings: what the page puts on its window never reaches it", async () => {
    const postProcessor = vi.fn();
    const pageConfig = { postProcessor };
    const run = runInPage(await bundle(HOOK_LIKE_ENTRY, true), {
      __zod_globalConfig: pageConfig,
    });
    expect(run.parses()).toBe(true);
    expect(postProcessor).not.toHaveBeenCalled();
    expect(pageConfig).toEqual({ postProcessor });
    expect(run.config).not.toBe(pageConfig);
  });

  it("without it, zod shares its settings with the page's window both ways (what it guards)", async () => {
    const postProcessor = vi.fn();
    const pageConfig = { postProcessor };
    const run = runInPage(await bundle(HOOK_LIKE_ENTRY, false), {
      __zod_globalConfig: pageConfig,
    });
    expect(run.parses()).toBe(true);
    expect(postProcessor).toHaveBeenCalled();
    expect(pageConfig).toMatchObject({ jitless: true });
    expect(Reflect.has(run.window, '__zod_globalRegistry')).toBe(true);
  });

  it('fails the build when a bundle still reaches a zod global through globalThis', async () => {
    await expect(
      bundle('export const leak = globalThis.__zod_globalConfig;', true),
    ).rejects.toThrow(
      "reaches zod's globals through globalThis, which in a hook script is the meeting page's window",
    );
  });
});
