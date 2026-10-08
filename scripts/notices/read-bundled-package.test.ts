// @vitest-environment node
/**
 * What the notices need from a bundled package: its name, version and licence from
 * `package.json`, its licence text, and for a copyleft library the address of its source. Some
 * packages publish no licence file; the project then keeps a copy of the one in their repository.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBundledPackage } from './read-bundled-package';

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-package-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes each file under the throwaway folder. */
function write(files: Record<string, string>): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

const at = (relativePath: string): string => path.join(root, relativePath);
const TEXTS = 'licence-texts';
const read = (dir: string) => readBundledPackage(at(dir), at(TEXTS));

describe('readBundledPackage', () => {
  it('reads the name, version and licence, and the licence file with Unix line ends', () => {
    write({
      'pkg/package.json': JSON.stringify({ name: 'alpha', version: '1.2.3', license: 'MIT' }),
      'pkg/LICENSE': '\r\nMIT License\r\n\r\nCopyright (c) Alpha authors  \r\n\r\n',
      'pkg/index.js': '',
    });

    expect(read('pkg')).toEqual({
      name: 'alpha',
      version: '1.2.3',
      licence: 'MIT',
      licenceText: { text: 'MIT License\n\nCopyright (c) Alpha authors', from: 'package' },
      repository: undefined,
    });
  });

  it.each(['LICENSE', 'LICENSE.md', 'license', 'LICENCE.txt', 'LICENSE-MIT.txt', 'COPYING'])(
    'finds the licence file named %s',
    (file) => {
      write({
        'pkg/package.json': JSON.stringify({ name: 'alpha', version: '1.0.0', license: 'MIT' }),
        [`pkg/${file}`]: 'the licence',
      });

      expect(read('pkg').licenceText).toEqual({ text: 'the licence', from: 'package' });
    },
  );

  it('joins every licence file of a dual-licensed package, in name order, and skips folders', () => {
    write({
      'pkg/package.json': JSON.stringify({
        name: 'beta',
        version: '2.0.0',
        license: '(MIT OR Apache-2.0)',
      }),
      'pkg/LICENSE-MIT': 'the MIT licence',
      'pkg/LICENSE-APACHE': 'the Apache licence',
      'pkg/licenses/third-party.txt': 'not this one',
    });

    expect(read('pkg').licenceText).toEqual({
      text: 'the Apache licence\n\nthe MIT licence',
      from: 'package',
    });
  });

  it('takes the project’s copy when the package publishes no licence file', () => {
    write({
      'node_modules/@scope/gamma/package.json': JSON.stringify({
        name: '@scope/gamma',
        version: '0.1.0',
        license: 'MIT',
      }),
      [`${TEXTS}/@scope/gamma/LICENSE`]: 'MIT License\r\n\r\nCopyright (c) Gamma authors\r\n',
    });

    expect(read('node_modules/@scope/gamma').licenceText).toEqual({
      text: 'MIT License\n\nCopyright (c) Gamma authors',
      from: 'project',
    });
  });

  it('has no licence text when neither the package nor the project has one', () => {
    write({
      'pkg/package.json': JSON.stringify({ name: 'delta', version: '1.0.0', license: 'MIT' }),
    });

    expect(read('pkg').licenceText).toBeUndefined();
  });

  it.each([
    { name: 'no license field', fields: {} },
    { name: 'the deprecated object form', fields: { license: { type: 'MIT' } } },
    { name: 'the deprecated licenses array', fields: { licenses: [{ type: 'MIT' }] } },
  ])('has no licence for $name, which is no SPDX expression', ({ fields }) => {
    write({
      'pkg/package.json': JSON.stringify({ name: 'epsilon', version: '1.0.0', ...fields }),
    });

    expect(read('pkg').licence).toBeUndefined();
  });

  it.each([
    { repository: 'https://github.com/a/b', url: 'https://github.com/a/b' },
    { repository: { url: 'git+https://github.com/a/b.git' }, url: 'https://github.com/a/b' },
    {
      repository: { type: 'git', url: 'https://gitlab.com/a/b.git' },
      url: 'https://gitlab.com/a/b',
    },
    { repository: 'git://github.com/a/b.git', url: undefined },
    { repository: 'git@github.com:a/b.git', url: undefined },
    { repository: 'a/b', url: undefined },
    { repository: { type: 'git' }, url: undefined },
    { repository: undefined, url: undefined },
  ])('reads the repository $repository as $url', ({ repository, url }) => {
    write({
      'pkg/package.json': JSON.stringify({ name: 'zeta', version: '1.0.0', repository }),
    });

    expect(read('pkg').repository).toBe(url);
  });

  it('fails on a package.json without a name or a version', () => {
    write({ 'pkg/package.json': JSON.stringify({ name: 'eta' }) });

    expect(() => read('pkg')).toThrow(`${at('pkg/package.json')} names no package and version`);
  });
});
