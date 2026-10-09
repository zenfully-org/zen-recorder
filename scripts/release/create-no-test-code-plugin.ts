// Relative imports only: wxt.config.ts loads this file without the "@" alias.
import { findTestBuildModules, type RenderedChunk } from './find-test-build-modules';

/** What the plugin reads of a built file: each chunk's modules. */
type BuiltFile = { type: 'asset' } | ({ type: 'chunk' } & RenderedChunk);

/**
 * A Vite plugin for release builds: the build fails when it ships code of the test build's probes
 * and faults (`findTestBuildModules`), with the modules it found and how to keep them out.
 */
export function createNoTestCodePlugin() {
  return {
    name: 'zen-recorder:no-test-code',
    generateBundle(
      this: { error: (message: string) => never },
      _options: unknown,
      bundle: Readonly<Record<string, BuiltFile>>,
    ): void {
      const chunks = Object.values(bundle).flatMap((file) => (file.type === 'chunk' ? [file] : []));
      const shipped = findTestBuildModules(chunks);
      if (shipped.length === 0) return;
      this.error(
        `a release build ships the test build's ${shipped.join(', ')}: call it only behind import.meta.env.WXT_E2E === '1', written with a dot, which the bundler replaces with a constant`,
      );
    },
  };
}
