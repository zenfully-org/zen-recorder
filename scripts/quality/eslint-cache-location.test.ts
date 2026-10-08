// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eslintCacheLocation } from './eslint-cache-location';

const root = '/work/repo';
const lockfile = "lockfileVersion: '9.0'\npackages:\n  eslint-plugin-sonarjs@4.2.2: {}\n";

describe('eslintCacheLocation', () => {
  it('keeps the cache under node_modules/.cache, which git ignores and the sources zip leaves out', () => {
    const relative = path.relative(root, eslintCacheLocation(root, lockfile)).split(path.sep);
    expect(relative.join('/')).toMatch(
      /^node_modules\/\.cache\/zen-recorder\/eslint\/[0-9a-f]{16}\.json$/,
    );
  });

  it('names the same file while the installed packages stay the same', () => {
    expect(eslintCacheLocation(root, lockfile)).toBe(eslintCacheLocation(root, `${lockfile}`));
  });

  it('names another file once a package changes, so a plugin upgrade lints everything again', () => {
    const upgraded = lockfile.replace('4.2.2', '4.3.0');
    expect(eslintCacheLocation(root, upgraded)).not.toBe(eslintCacheLocation(root, lockfile));
  });
});
