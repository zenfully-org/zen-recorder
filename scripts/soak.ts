/**
 * `pnpm soak`: e2e scenario 92 alone, one long recording with video on each service's fake page
 * (`SOAK_MINUTES`, 10 by default; `E2E_PROVIDERS` narrows the services). The weekly Soak workflow
 * runs it for 120 minutes. Scenario 92 runs only when named, so `pnpm test:e2e` never takes it.
 */
process.env['E2E_SCENARIOS'] = '92';
await import('./e2e-fixture');
