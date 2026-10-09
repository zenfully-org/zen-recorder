/**
 * `wxt.config.ts` defines `import.meta.env.WXT_E2E` for every build: '1' in a test build
 * (`pnpm build:e2e`), '' otherwise. The bundler replaces it with that string, so code behind
 * `import.meta.env.WXT_E2E === '1'` is left out of a release build. Read it with a dot: the
 * bundler does not replace `import.meta.env['WXT_E2E']`, which a release build then looks up at
 * run time, shipping the test code behind it.
 */
interface ImportMetaEnv {
  readonly WXT_E2E: string;
}
