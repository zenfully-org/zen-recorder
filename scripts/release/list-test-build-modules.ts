/**
 * The modules only a test build (`pnpm build:e2e`) may bundle: the probes the end-to-end run reads
 * the extension through and the faults it injects. Each one is reached only behind
 * `import.meta.env.WXT_E2E === '1'`, which a release build replaces with a constant, so the bundler
 * leaves them out, and a release build fails when it bundles one (`wxt.config.ts`). A module
 * written for the test build alone belongs in this list.
 */
export function listTestBuildModules(): readonly string[] {
  return [
    'src/lib/background/create-tab-port-faults.ts',
    'src/lib/capture/install-display-media-stub.ts',
    'src/lib/finalize/create-name-refusal.ts',
    'src/lib/finalize/create-save-failure.ts',
    'src/lib/finalize/create-save-hold.ts',
    'src/lib/page/redact-presence.ts',
    'src/lib/settings/create-settings-probes.ts',
    'src/lib/storage/create-fault-injecting-store.ts',
    'src/wiring/create-background-test-build.ts',
    'src/wiring/create-popup-probes.ts',
    'src/wiring/expose-page-session.ts',
    'src/wiring/expose-status-card.ts',
    'src/wiring/install-debug-bridge.ts',
  ];
}
