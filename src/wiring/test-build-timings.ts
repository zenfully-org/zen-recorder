/**
 * Test builds only (`pnpm build:e2e`): two of the background's waits, shortened so the end-to-end
 * run spends seconds on them instead of minutes. A release build keeps its own (30 s and a
 * minute): the bundler replaces `import.meta.env.WXT_E2E === '1'` with a constant, so a release
 * build leaves this module out (`scripts/release/list-test-build-modules.ts` names it, and a
 * release build fails when it bundles it).
 *
 * The order between them is what the scenarios rely on, as it is in a release: a page that lives
 * sends a chunk every few seconds, sends one that was not acked again 11 s later, and pairs with a
 * fresh background within seconds, so the recovery pass runs once the pages had the time to claim
 * their recordings again, and a recording counts as abandoned only once it has been quiet for
 * longer than a page that lives can be.
 */
export const TEST_BUILD_TIMINGS = {
  /** From a background's start to its recovery pass (30 s in a release). */
  recoveryDelayMs: 10_000,
  /** How long a recording no tab claims stays quiet before it counts as abandoned (a minute). */
  abandonedAfterMs: 20_000,
} as const;
