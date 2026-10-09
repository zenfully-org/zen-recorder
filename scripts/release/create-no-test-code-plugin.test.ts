import { describe, expect, it } from 'vitest';
import { createNoTestCodePlugin } from './create-no-test-code-plugin';

const context = {
  error: (message: string): never => {
    throw new Error(message);
  },
};
const bundleWith = (renderedLength: number) => ({
  'background.js': {
    type: 'chunk' as const,
    modules: {
      '/work/zen-recorder/src/entrypoints/background.ts': { renderedLength: 900 },
      '/work/zen-recorder/src/wiring/create-background-test-build.ts': { renderedLength },
    },
  },
  'icons/16.png': { type: 'asset' as const },
});

describe('createNoTestCodePlugin', () => {
  it('lets a release build through when the test build left none of its code', () => {
    const plugin = createNoTestCodePlugin();
    expect(() => plugin.generateBundle.call(context, {}, bundleWith(0))).not.toThrow();
  });

  it('fails the build, naming the test-build module whose code ships', () => {
    const plugin = createNoTestCodePlugin();
    expect(() => plugin.generateBundle.call(context, {}, bundleWith(1200))).toThrow(
      "a release build ships the test build's src/wiring/create-background-test-build.ts: call it only behind import.meta.env.WXT_E2E === '1'",
    );
  });
});
