// @vitest-environment node
/**
 * Tailwind writes a CSS rule for every class name it finds in the files it scans for this
 * stylesheet, so those files decide the popup's and the Options page's CSS. Left to detect its
 * sources, it scanned the whole working copy: a word in a test, a script, a doc or a workflow that
 * looked like a class name added a rule to the extension. addons.mozilla.org's reviewers rebuild
 * the extension from the sources zip, which holds no tests and no hidden files, and their build
 * must equal the XPI byte for byte. The scanner here is set up the way `@tailwindcss/vite` sets up
 * its own in the build.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const ROOT = path.resolve(import.meta.dirname, '../..');
const STYLESHEET = path.join(ROOT, 'src/styles/globals.css');
/** The folders whose files render the popup and the Options page, the only pages using it. */
const UI_FOLDERS = ['src/entrypoints/', 'src/components/'];

/** The files Tailwind scans for the stylesheet, relative to the project root. */
async function scannedFiles(): Promise<string[]> {
  const compiler = await compile(readFileSync(STYLESHEET, 'utf8'), {
    base: path.dirname(STYLESHEET),
    onDependency: () => {},
  });
  // `@tailwindcss/vite`: no `source()` scans everything under the project root, `source(none)`
  // nothing but the `@source` rules.
  const root =
    compiler.root === 'none'
      ? []
      : compiler.root === null
        ? [{ base: ROOT, pattern: '**/*', negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
  scanner.scan();
  return scanner.files.map((file) => path.relative(ROOT, file)).sort();
}

describe('globals.css', () => {
  it('takes class names only from the sources of the pages that use it', async () => {
    const outside = (await scannedFiles()).filter(
      (file) => !UI_FOLDERS.some((folder) => file.startsWith(folder)),
    );

    expect(outside).toEqual([]);
  });

  it('takes no class names from tests, which the sources zip leaves out', async () => {
    const tests = (await scannedFiles()).filter((file) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
    );

    expect(tests).toEqual([]);
  });

  it.each([
    'src/entrypoints/popup/App.tsx',
    'src/entrypoints/options/App.tsx',
    'src/components/ui/button.tsx',
  ])('still takes the class names of %s', async (file) => {
    expect(await scannedFiles()).toContain(file);
  });

  it.each(['@tailwindcss/node', '@tailwindcss/oxide'])(
    'checks with the copy of %s that the build uses',
    (name) => {
      const here = createRequire(import.meta.url);
      const build = createRequire(here.resolve('@tailwindcss/vite'));

      expect(realpathSync(here.resolve(name))).toBe(realpathSync(build.resolve(name)));
    },
  );
});
