import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Everything under src/lib must be fully covered. Entrypoints (WXT wiring) and the React UI
      // (no automated UI tests yet) are exercised by the e2e run instead.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/**/types.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      // `json` writes .coverage/coverage-final.json, from which CI's report names the lines left
      // uncovered: the text table cuts long file names.
      reporter: ['text-summary', 'text', 'html', 'json'],
      reportsDirectory: '.coverage',
    },
  },
});
