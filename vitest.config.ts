import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { listIgnoredFiles } from './scripts/git-files';

// A TypeScript file git ignores (a scratch folder, a copy) is no part of the project: its tests do
// not run, and it counts for no coverage.
const ignored = listIgnoredFiles(import.meta.dirname, ['src', 'scripts']).filter((file) =>
  /\.tsx?$/.test(file),
);

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...ignored],
    coverage: {
      provider: 'v8',
      // Everything under src/lib must be fully covered. Entrypoints (WXT wiring) and the React UI
      // (no automated UI tests yet) are exercised by the e2e run instead.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/**/types.ts', ...ignored],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      // `json` writes .coverage/coverage-final.json, from which CI's report names the lines left
      // uncovered: the text table cuts long file names.
      reporter: ['text-summary', 'text', 'html', 'json'],
      reportsDirectory: '.coverage',
    },
  },
});
