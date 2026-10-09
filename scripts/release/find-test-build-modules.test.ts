import { describe, expect, it } from 'vitest';
import { findTestBuildModules } from './find-test-build-modules';

const ROOT = '/work/zen-recorder';
const shipping = (length: number) => ({ renderedLength: length });

describe('findTestBuildModules', () => {
  it('finds nothing in chunks of production modules and packages', () => {
    const chunk = {
      modules: {
        [`${ROOT}/src/entrypoints/background.ts`]: shipping(900),
        [`${ROOT}/node_modules/zod/v4/classic/schemas.js`]: shipping(5000),
        '\0virtual:wxt-plugins': shipping(40),
      },
    };
    expect(findTestBuildModules([chunk])).toEqual([]);
  });

  it('names each test-build module whose code ships, once, relative to the project', () => {
    const background = {
      modules: {
        [`${ROOT}/src/wiring/install-debug-bridge.ts`]: shipping(300),
        [`${ROOT}/src/entrypoints/background.ts`]: shipping(900),
      },
    };
    const contentScript = {
      modules: {
        // Vite adds a query to some ids, and Windows separates folders with backslashes.
        [`${ROOT}/src/wiring/install-debug-bridge.ts?v=1`]: shipping(300),
        'C:\\work\\zen-recorder\\src\\lib\\storage\\create-fault-injecting-store.ts': shipping(80),
      },
    };
    expect(findTestBuildModules([background, contentScript])).toEqual([
      'src/lib/storage/create-fault-injecting-store.ts',
      'src/wiring/install-debug-bridge.ts',
    ]);
  });

  // The bundler can keep a module in a chunk after dropping all of its code.
  it('leaves out a test-build module that ships no code', () => {
    const chunk = { modules: { [`${ROOT}/src/wiring/create-popup-probes.ts`]: shipping(0) } };
    expect(findTestBuildModules([chunk])).toEqual([]);
  });
});
