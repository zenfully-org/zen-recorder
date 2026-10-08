// @vitest-environment node
/**
 * The last step of every build: the extension's folder gets the project's `LICENSE` and the
 * notices of the packages it bundles, or the build fails when one of them may not be shipped: a
 * licence outside the allowed list, none at all, no licence text, or a library under the MPL
 * without a place to find its source.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeLicenceNotices } from './write-licence-notices';

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-notices-')));
  write({ LICENSE: 'MIT License\r\n\r\nCopyright (c) 2026 Zen Recorder contributors\r\n' });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes each file under the throwaway project. */
function write(files: Record<string, string>): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

/** Installs a package with one module, and returns that module's id. */
function install(
  dir: string,
  fields: Record<string, unknown>,
  { licenceFile }: { licenceFile: boolean } = { licenceFile: true },
): string {
  write({ [`${dir}/package.json`]: JSON.stringify(fields), [`${dir}/index.js`]: '' });
  if (licenceFile) write({ [`${dir}/LICENSE`]: 'the licence of this package' });
  return path.join(root, dir, 'index.js');
}

const outDir = () => path.join(root, '.output/firefox-mv3');
const project = { name: 'Zen Recorder', version: '0.4.0' };
const build = (moduleIds: string[]) =>
  writeLicenceNotices({ root, outDir: outDir(), moduleIds, project });

describe('writeLicenceNotices', () => {
  it('ships the project’s licence and the notices of what the build bundles', () => {
    const moduleIds = [
      install('node_modules/alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' }),
      install('node_modules/mediabunny', {
        name: 'mediabunny',
        version: '1.55.5',
        license: 'MPL-2.0',
        repository: { type: 'git', url: 'git+https://github.com/Vanilagy/mediabunny.git' },
      }),
      install(
        'node_modules/@scope/gamma',
        { name: '@scope/gamma', version: '3.0.0', license: 'ISC' },
        { licenceFile: false },
      ),
      path.join(root, 'src/main.ts'),
    ];
    write({
      'scripts/notices/licence-texts/@scope/gamma/LICENSE': 'ISC License, from the repository',
    });

    expect(build(moduleIds)).toEqual(['LICENSE', 'THIRD-PARTY-NOTICES.md']);

    expect(readFileSync(path.join(outDir(), 'LICENSE'), 'utf8')).toBe(
      'MIT License\n\nCopyright (c) 2026 Zen Recorder contributors\n',
    );
    const notices = readFileSync(path.join(outDir(), 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices.match(/^\| .* \|$/gm)).toEqual([
      '| Package | Version | Licence |',
      '| --- | --- | --- |',
      '| @scope/gamma | 3.0.0 | ISC |',
      '| alpha | 1.0.0 | MIT |',
      '| mediabunny | 1.55.5 | MPL-2.0 |',
    ]);
    expect(notices).toContain('```text\nISC License, from the repository\n```');
    expect(notices).toContain(
      'Licence: MPL-2.0. Its source code is at https://github.com/Vanilagy/mediabunny (version 1.55.5).',
    );
  });

  it('lists a package once when the bundle takes it from two folders', () => {
    const moduleIds = [
      install('node_modules/.pnpm/beta@2.0.0_react@19/node_modules/beta', {
        name: 'beta',
        version: '2.0.0',
        license: 'MIT',
      }),
      install('node_modules/.pnpm/beta@2.0.0_react@18/node_modules/beta', {
        name: 'beta',
        version: '2.0.0',
        license: 'MIT',
      }),
    ];

    build(moduleIds);

    const notices = readFileSync(path.join(outDir(), 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices.match(/^## .*$/gm)).toEqual(['## beta 2.0.0']);
  });

  it('fails the build, naming every package it may not ship, and writes nothing', () => {
    const moduleIds = [
      install('node_modules/fine', { name: 'fine', version: '1.0.0', license: 'MIT' }),
      install('node_modules/copyleft', {
        name: 'copyleft',
        version: '1.0.0',
        license: 'GPL-3.0-only',
      }),
      install('node_modules/nameless', { name: 'nameless', version: '1.0.0' }),
      install(
        'node_modules/@scope/textless',
        { name: '@scope/textless', version: '1.0.0', license: 'MIT' },
        { licenceFile: false },
      ),
      install('node_modules/sourceless', {
        name: 'sourceless',
        version: '1.0.0',
        license: 'MPL-2.0',
      }),
    ];

    expect(() => build(moduleIds)).toThrow(
      [
        'The extension bundles packages it may not ship. The project is MIT, so what it bundles must be under a permissive licence or MPL-2.0 (scripts/notices/is-allowed-licence.ts lists them), with a licence text to ship:',
        '- @scope/textless 1.0.0 publishes no licence file: add the one from its repository as scripts/notices/licence-texts/@scope/textless/LICENSE',
        '- copyleft 1.0.0 is under GPL-3.0-only, which the project may not bundle',
        '- nameless 1.0.0 names no licence in its package.json',
        '- sourceless 1.0.0 is under the MPL, which asks to say where its source is, but its package.json names no https repository',
      ].join('\n'),
    );
    expect(existsSync(outDir())).toBe(false);
  });
});
