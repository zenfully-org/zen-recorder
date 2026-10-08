// @vitest-environment node
/**
 * `listBundledPackages` against a throwaway project: a `node_modules` laid out the way pnpm and npm
 * lay it out, and the module ids a build reports for its chunks. Tailwind's compiler resolves the
 * stylesheet's `@import`s itself, so the packages behind them never appear among the module ids
 * and are found from the stylesheet.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listBundledPackages } from './list-bundled-packages';

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-bundled-')));
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

const at = (relativePath: string): string => path.join(root, relativePath);

describe('listBundledPackages', () => {
  it('names the package folder of every module a chunk takes from node_modules, once each', () => {
    write({
      'node_modules/.pnpm/alpha@1.0.0/node_modules/alpha/package.json': '{}',
      'node_modules/.pnpm/alpha@1.0.0/node_modules/alpha/dist/esm/package.json': '{}',
      'node_modules/.pnpm/alpha@1.0.0/node_modules/alpha/dist/esm/index.js': '',
      'node_modules/@scope/beta/package.json': '{}',
      'node_modules/@scope/beta/lib/a.js': '',
      'node_modules/@scope/beta/lib/b.js': '',
      'src/main.ts': '',
      'src/styles/plain.css': 'body { margin: 0; }',
    });

    expect(
      listBundledPackages([
        at('src/main.ts'),
        at('src/styles/plain.css'),
        at('node_modules/.pnpm/alpha@1.0.0/node_modules/alpha/dist/esm/index.js'),
        at('node_modules/@scope/beta/lib/a.js'),
        `${at('node_modules/@scope/beta/lib/b.js')}?commonjs-es-import`,
      ]),
    ).toEqual([
      at('node_modules/.pnpm/alpha@1.0.0/node_modules/alpha'),
      at('node_modules/@scope/beta'),
    ]);
  });

  it('skips the bundler’s virtual modules, whose ids start with a NUL byte', () => {
    write({ 'node_modules/gamma/index.js': '' });

    expect(
      listBundledPackages([
        '\0rolldown/runtime.js',
        `\0${at('node_modules/gamma/index.js')}?commonjs-proxy`,
      ]),
    ).toEqual([]);
  });

  it('adds the packages a project stylesheet imports or loads as a Tailwind plugin', () => {
    write({
      'src/styles/globals.css': [
        '@import "tailwindcss";',
        "@import 'tw-animate-css' layer(utilities);",
        '@import url("@scope/theme/colors.css");',
        '@import "./local.css";',
        '@import "/absolute.css";',
        '@import url("https://example.com/font.css");',
        '/* @import "commented-out"; */',
        '@plugin "@scope/forms";',
        '@import "tailwindcss";',
      ].join('\n'),
      'src/styles/local.css': '',
      'node_modules/tailwindcss/package.json': '{}',
      'node_modules/tw-animate-css/package.json': '{}',
      'node_modules/@scope/theme/package.json': '{}',
      'node_modules/@scope/forms/package.json': '{}',
    });

    expect(listBundledPackages([`${at('src/styles/globals.css')}?direct`])).toEqual([
      at('node_modules/@scope/forms'),
      at('node_modules/@scope/theme'),
      at('node_modules/tailwindcss'),
      at('node_modules/tw-animate-css'),
    ]);
  });

  it('resolves a stylesheet import the way Node does, from the nearest node_modules up', () => {
    write({
      'packages/ui/styles.css': '@import "delta";',
      'node_modules/delta/package.json': '{}',
    });

    expect(listBundledPackages([at('packages/ui/styles.css')])).toEqual([at('node_modules/delta')]);
  });

  it('reads a stylesheet inside node_modules as part of its package, not for its imports', () => {
    write({
      'node_modules/epsilon/package.json': '{}',
      'node_modules/epsilon/style.css': '@import "not-installed";',
    });

    expect(listBundledPackages([at('node_modules/epsilon/style.css')])).toEqual([
      at('node_modules/epsilon'),
    ]);
  });

  it('fails when a stylesheet imports a package that is not installed, rather than miss it', () => {
    write({ 'src/styles/globals.css': '@import "missing-package/theme.css";' });

    expect(() => listBundledPackages([at('src/styles/globals.css')])).toThrow(
      `${at('src/styles/globals.css')} imports "missing-package", which is not installed`,
    );
  });
});
