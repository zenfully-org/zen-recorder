/**
 * End-to-end test: launches the Firefox of `pnpm setup:firefox` through Puppeteer (WebDriver BiDi),
 * installs the built extension temporarily and runs the same scenarios against every provider's
 * fake page (`src/test/fixtures/fake-<id>.html`, served by `scripts/fixture-server.ts`). Each
 * scenario is a `scripts/e2e/scenario-<name>.ts` of its own, whose header says what it guards, and
 * joins the run by itself: it exports `registration` (its name, the scenario it runs after, its
 * function), and the run lists the folder and orders what it finds (`findScenarioRegistrations`,
 * `orderScenarios`). The contract a fake page has to implement is in `scripts/e2e/harness.ts`.
 *
 * Before the first scenario it checks that the audio measures read the span they are given, in a
 * file whose video starts after its audio (`assertAudioMeasuresWork`). Then it takes the machine's
 * browser lock (`holdBrowserLock`): another run of the project that holds it (another working
 * copy's, a benchmark) has its Firefox running and the fixture port taken, so this one waits for
 * it, and says for whom.
 *
 * When a service's run fails, it prints one line that names the service, the scenario and the
 * check (`describeE2eFailure`, which CI's report reads), and saves the extension's Diagnostics log
 * to `.e2e/diagnostics-<service>.json`.
 *
 * Usage: `pnpm test:e2e` (builds the e2e flavour first).
 * Env: E2E_PROVIDERS=meet,zoom and
 *      E2E_SCENARIOS=routing,35,39,1,3,4,6,7,8,9,41,44,11,12,13,14,15,16,17,20,22,45,49,58,55,68,33,37,38,5,2,25,10
 *      to run a subset · E2E_SHARD=2/6 runs the second of six shards of the run (CI splits a
 *      service's run over jobs side by side, by the seconds each scenario took on CI:
 *      `scripts/e2e/scenario-seconds.json`, which `pnpm e2e:seconds` measures) ·
 *      E2E_LIST=1 prints the scenarios each service would run, in order, and stops ·
 *      E2E_HEADLESS=0 to watch it · E2E_KEEP_OPEN=1 · PULSE_SERVER (default: the
 *      private test audio server of `scripts/test-audio.sh` when it is running) ·
 *      E2E_FIXTURE_PORT (default 4175) · E2E_FIREFOX (path to the Firefox binary) ·
 *      ZEN_RECORDER_BROWSER_LOCK (the lock file; default: one in the system's temporary folder).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { holdBrowserLock } from './browser-lock/hold-browser-lock';
import { assertAudioMeasuresWork } from './e2e/check-audio-measures';
import { describeE2eFailure, type FailedScenario } from './e2e/describe-e2e-failure';
import { findScenarioRegistrations } from './e2e/find-scenario-registrations';
import {
  assertAudioWorks,
  DOWNLOAD_DIR,
  E2E_DIR,
  EXTENSION_DIR,
  FIREFOX,
  launch,
  PORT,
  saveDiagnostics,
  selectAudioServer,
  waitForExtensionReady,
} from './e2e/harness';
import { orderScenarios, type Scenario, type ScenarioOrder } from './e2e/order-scenarios';
import { readScenarioSeconds } from './e2e/read-scenario-seconds';
import { shardScenarios } from './e2e/shard-scenarios';
import { type FixtureTarget, meetingUrl, selectTargets } from './e2e/targets';
import { startFixtureServer } from './fixture-server';

const diagnosticsFile = (target: FixtureTarget): string =>
  path.join(E2E_DIR, `diagnostics-${target.id}.json`);

/** How long each scenario took on CI, per service: what a shard is cut by. */
const SCENARIO_SECONDS: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'e2e/scenario-seconds.json'), 'utf8'),
);

/** The scenarios a service's run runs: all of the run, or those `E2E_SCENARIOS` names; then a shard. */
function selectScenarios(order: ScenarioOrder, provider: string): [string, Scenario][] {
  const wanted = (process.env['E2E_SCENARIOS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const selected =
    wanted.length === 0
      ? order.run
      : [...order.run, ...order.onRequest].filter(([name]) => wanted.includes(name));
  const secondsOf = readScenarioSeconds(SCENARIO_SECONDS, provider);
  return shardScenarios(selected, process.env['E2E_SHARD'], ([name]) => secondsOf(name));
}

/**
 * One browser per provider, so a provider's leftovers cannot influence the next one. `progress`
 * names the scenario running, so a failure can say which one it was.
 */
async function runTarget(
  target: FixtureTarget,
  scenarios: [string, Scenario][],
  progress: { scenario: FailedScenario | null },
): Promise<void> {
  console.log(`\n━━ ${target.label} ━━`);
  const browser = await launch();
  try {
    const id = await browser.installExtension(EXTENSION_DIR);
    console.log(`extension installed: ${id}`);
    await waitForExtensionReady(browser, meetingUrl(target));
    await assertAudioWorks(browser, meetingUrl(target));
    const context = { browser, target };
    for (const [name, scenario] of scenarios) {
      progress.scenario = { name, test: scenario.name };
      const started = Date.now();
      await scenario(context);
      console.log(`  ✓ ${name} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  } catch (error) {
    console.log(await saveDiagnostics(browser, meetingUrl(target), diagnosticsFile(target)));
    throw error;
  } finally {
    if (process.env['E2E_KEEP_OPEN'] !== '1') await browser.close();
  }
}

async function main(): Promise<void> {
  // Before anything else: a scenario file without a registration, a taken name, an unknown
  // `after` or a loop stops the run here.
  const order = orderScenarios(await findScenarioRegistrations());
  const { run, skipped } = selectTargets();
  for (const target of skipped) console.log(`⚠ ${target.label}: no fixture page yet, skipped`);
  if (run.length === 0) throw new Error('no provider to test');
  if (process.env['E2E_LIST'] === '1') {
    for (const target of run) {
      console.log(
        `${target.id}: ${selectScenarios(order, target.id)
          .map(([name]) => name)
          .join(',')}`,
      );
    }
    return;
  }
  if (!existsSync(EXTENSION_DIR)) throw new Error(`build first: ${EXTENSION_DIR} missing`);
  if (!existsSync(FIREFOX)) throw new Error(`run pnpm setup:firefox first: ${FIREFOX} missing`);
  // Before any scenario relies on them: the audio measures read the span they are given.
  assertAudioMeasuresWork();
  console.log('audio measures: ok (they read the seconds before a late first video frame)');
  // Before anything a second run would share: the downloads folder, the fixture port, the browser.
  await holdBrowserLock();
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  await Promise.all(run.map((target) => rm(diagnosticsFile(target), { force: true })));
  console.log(`audio server: ${selectAudioServer()}`);
  const server = await startFixtureServer(PORT);
  const failures: string[] = [];
  for (const target of run) {
    const progress: { scenario: FailedScenario | null } = { scenario: null };
    try {
      await runTarget(target, selectScenarios(order, target.id), progress);
      console.log(`✔ ${target.label} passed`);
    } catch (error) {
      failures.push(target.label);
      console.error(describeE2eFailure(target.id, progress.scenario, error));
      console.error(error);
    }
  }
  server.close();
  console.log(
    failures.length === 0
      ? `\n✔ e2e passed (${run.map((target) => target.id).join(', ')})`
      : `\n✘ e2e failed for: ${failures.join(', ')}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
