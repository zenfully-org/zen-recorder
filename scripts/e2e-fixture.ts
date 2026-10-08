/**
 * End-to-end test: launches the Firefox of `pnpm setup:firefox` through Puppeteer (WebDriver BiDi),
 * installs the built extension temporarily and runs the same scenarios against every provider's
 * fake page (`src/test/fixtures/fake-<id>.html`, served by `scripts/fixture-server.ts`). The
 * scenarios and what each one guards are listed in `scripts/e2e/scenarios.ts`, and newer ones each
 * in a `scripts/e2e/scenario-<name>.ts` of its own; the contract a fake page has to implement is
 * in `scripts/e2e/harness.ts`.
 *
 * Usage: `pnpm test:e2e` (builds the e2e flavour first).
 * Env: E2E_PROVIDERS=meet,zoom and
 *      E2E_SCENARIOS=routing,35,39,1,3,4,6,7,8,9,41,11,12,13,14,15,16,17,20,22,33,37,38,5,2,25,10
 *      to run a subset · E2E_HEADLESS=0 to watch it · E2E_KEEP_OPEN=1 · PULSE_SERVER (default: the
 *      private test audio server of `scripts/test-audio.sh` when it is running) ·
 *      E2E_FIXTURE_PORT (default 4175) · E2E_FIREFOX (path to the Firefox binary).
 */
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import {
  assertAudioWorks,
  DOWNLOAD_DIR,
  EXTENSION_DIR,
  FIREFOX,
  launch,
  PORT,
  selectAudioServer,
} from './e2e/harness';
import { scenarioAudioErrorDuringOutage } from './e2e/scenario-audio-error-during-outage';
import { scenarioNoCodeFromStrings } from './e2e/scenario-no-code-from-strings';
import { scenarioRecoveryWhileDraining } from './e2e/scenario-recovery-while-draining';
import { scenarioStartNotStored } from './e2e/scenario-start-not-stored';
import { scenarioStatusCard } from './e2e/scenario-status-card';
import {
  type ScenarioContext,
  scenarioAudioOnly,
  scenarioAutoRecordAndHangup,
  scenarioBacklogFull,
  scenarioBusyPageKeepsQueuedAudio,
  scenarioChunkBookkeeping,
  scenarioChunkNotStored,
  scenarioCrashWhileChunkStored,
  scenarioEncoderErrorRestart,
  scenarioEncoderErrorWhilePaused,
  scenarioEndNoticeLost,
  scenarioExtensionReload,
  scenarioFirstSecondsHaveAudio,
  scenarioGuestKnocks,
  scenarioInterruptionNotStored,
  scenarioPageGoneWhileRecording,
  scenarioProjectNotice,
  scenarioProviderRouting,
  scenarioRecordAlone,
  scenarioRecoveryOnTabClose,
  scenarioRefusedFileName,
  scenarioSameNameAtOnce,
  scenarioStopBeforeFirstSample,
  scenarioStoppedMicrophone,
  scenarioSustainedBacklog,
  scenarioVideoErrorDuringOutage,
} from './e2e/scenarios';
import { type FixtureTarget, meetingUrl, selectTargets } from './e2e/targets';
import { startFixtureServer } from './fixture-server';

/** In run order; the names are what `E2E_SCENARIOS` selects. */
const SCENARIOS: [string, (context: ScenarioContext) => Promise<void>][] = [
  ['routing', scenarioProviderRouting],
  // Early: the first recording of the browser, in a page whose window runs no audio graph yet.
  ['35', scenarioFirstSecondsHaveAudio],
  ['39', scenarioNoCodeFromStrings],
  ['1', scenarioAutoRecordAndHangup],
  ['3', scenarioRecordAlone],
  ['4', scenarioAudioOnly],
  ['6', scenarioEncoderErrorRestart],
  ['7', scenarioEncoderErrorWhilePaused],
  ['8', scenarioSameNameAtOnce],
  ['9', scenarioChunkNotStored],
  ['41', scenarioStartNotStored],
  ['11', scenarioRefusedFileName],
  ['12', scenarioStopBeforeFirstSample],
  ['13', scenarioStoppedMicrophone],
  ['14', scenarioBusyPageKeepsQueuedAudio],
  ['15', scenarioEndNoticeLost],
  ['16', scenarioSustainedBacklog],
  ['17', scenarioGuestKnocks],
  ['20', scenarioPageGoneWhileRecording],
  ['22', scenarioProjectNotice],
  ['33', scenarioBacklogFull],
  ['37', scenarioVideoErrorDuringOutage],
  ['40', scenarioAudioErrorDuringOutage],
  ['48', scenarioStatusCard],
  // It reloads the extension, as the ones after it do.
  ['38', scenarioChunkBookkeeping],
  ['43', scenarioRecoveryWhileDraining],
  ['5', scenarioExtensionReload],
  ['2', scenarioRecoveryOnTabClose],
  ['25', scenarioCrashWhileChunkStored],
  // Last: it reloads the extension twice.
  ['10', scenarioInterruptionNotStored],
];

function selectScenarios(): typeof SCENARIOS {
  const wanted = (process.env['E2E_SCENARIOS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return SCENARIOS.filter(([name]) => wanted.length === 0 || wanted.includes(name));
}

/** One browser per provider, so a provider's leftovers cannot influence the next one. */
async function runTarget(target: FixtureTarget): Promise<void> {
  console.log(`\n━━ ${target.label} ━━`);
  const browser = await launch();
  try {
    const id = await browser.installExtension(EXTENSION_DIR);
    console.log(`extension installed: ${id}`);
    await assertAudioWorks(browser, meetingUrl(target));
    const context = { browser, target };
    for (const [name, scenario] of selectScenarios()) {
      const started = Date.now();
      await scenario(context);
      console.log(`  ✓ ${name} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  } finally {
    if (process.env['E2E_KEEP_OPEN'] !== '1') await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(EXTENSION_DIR)) throw new Error(`build first: ${EXTENSION_DIR} missing`);
  if (!existsSync(FIREFOX)) throw new Error(`run pnpm setup:firefox first: ${FIREFOX} missing`);
  const { run, skipped } = selectTargets();
  for (const target of skipped) console.log(`⚠ ${target.label}: no fixture page yet, skipped`);
  if (run.length === 0) throw new Error('no provider to test');
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  console.log(`audio server: ${selectAudioServer()}`);
  const server = await startFixtureServer(PORT);
  const failures: string[] = [];
  for (const target of run) {
    try {
      await runTarget(target);
      console.log(`✔ ${target.label} passed`);
    } catch (error) {
      failures.push(target.label);
      console.error(`✘ ${target.label} failed:`, error);
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
