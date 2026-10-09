/**
 * The end-to-end run's build (`pnpm build:e2e`): the production build plus the test probes, with
 * the content scripts also matching the local fixture pages. It sets the two variables the build
 * reads and runs WXT's build in this process, so the command works in every shell: cmd and
 * PowerShell, which pnpm uses on Windows, have no `VAR=value command`.
 *
 * Usage: `pnpm build:e2e`.
 */
import { build } from 'wxt';

// Read by wxt.config.ts: the content scripts also match the fixture server's pages.
process.env['ZEN_RECORDER_E2E'] = '1';
// Read by the bundles as `import.meta.env.WXT_E2E`: the test probes and fault injection.
process.env['WXT_E2E'] = '1';

async function main(): Promise<void> {
  await build({ browser: 'firefox', manifestVersion: 3 });
}

void main();
