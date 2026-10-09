import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listTestBuildModules } from './list-test-build-modules';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('listTestBuildModules', () => {
  // A module renamed or moved without its entry here would ship in a release build unnoticed.
  it('names modules that exist', () => {
    const missing = listTestBuildModules().filter((file) => !existsSync(path.join(ROOT, file)));
    expect(missing).toEqual([]);
  });
});
