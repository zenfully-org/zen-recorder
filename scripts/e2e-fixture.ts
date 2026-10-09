/**
 * End-to-end test: launches the Firefox of `pnpm setup:firefox` through Puppeteer (WebDriver BiDi),
 * installs the built extension temporarily and runs the same scenarios against every provider's
 * fake page (`src/test/fixtures/fake-<id>.html`, served by `scripts/fixture-server.ts`). The
 * scenarios and what each one guards are listed in `scripts/e2e/scenarios.ts`, and newer ones each
 * in a `scripts/e2e/scenario-<name>.ts` of its own; the contract a fake page has to implement is
 * in `scripts/e2e/harness.ts`.
 *
 * Before the first scenario it checks that the audio measures read the span they are given, in a
 * file whose video starts after its audio (`assertAudioMeasuresWork`).
 *
 * When a service's run fails, it prints one line that names the service, the scenario and the
 * check (`describeE2eFailure`, which CI's report reads), and saves the extension's Diagnostics log
 * to `.e2e/diagnostics-<service>.json`.
 *
 * Usage: `pnpm test:e2e` (builds the e2e flavour first).
 * Env: E2E_PROVIDERS=meet,zoom and
 *      E2E_SCENARIOS=routing,35,39,1,3,4,6,7,8,9,41,44,11,12,13,14,15,16,17,20,22,45,49,58,55,68,33,37,38,5,2,25,10
 *      to run a subset · E2E_HEADLESS=0 to watch it · E2E_KEEP_OPEN=1 · PULSE_SERVER (default: the
 *      private test audio server of `scripts/test-audio.sh` when it is running) ·
 *      E2E_FIXTURE_PORT (default 4175) · E2E_FIREFOX (path to the Firefox binary).
 */
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertAudioMeasuresWork } from './e2e/check-audio-measures';
import { describeE2eFailure, type FailedScenario } from './e2e/describe-e2e-failure';
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
} from './e2e/harness';
import { scenarioAloneSaysWaiting } from './e2e/scenario-alone-says-waiting';
import { scenarioAnnouncedWhilePortDown } from './e2e/scenario-announced-while-port-down';
import { scenarioAudioErrorDuringOutage } from './e2e/scenario-audio-error-during-outage';
import { scenarioBacklogFullTold } from './e2e/scenario-backlog-full-told';
import { scenarioBusyPageAudio } from './e2e/scenario-busy-page-audio';
import { scenarioCameraOffAlone } from './e2e/scenario-camera-off-alone';
import { scenarioCardClosedToPage } from './e2e/scenario-card-closed-to-page';
import { scenarioClosedConnections } from './e2e/scenario-closed-connections';
import { scenarioColoursMatchTag } from './e2e/scenario-colours-match-tag';
import { scenarioDiskFullTold } from './e2e/scenario-disk-full-told';
import { scenarioKeyboardShortcut } from './e2e/scenario-keyboard-shortcut';
import { scenarioLogAcrossPortDrop } from './e2e/scenario-log-across-port-drop';
import { scenarioMediaClock } from './e2e/scenario-media-clock';
import { scenarioMeetCountsPeople } from './e2e/scenario-meet-counts-people';
import { scenarioNoCodeFromStrings } from './e2e/scenario-no-code-from-strings';
import { scenarioPageGoneTail } from './e2e/scenario-page-gone-tail';
import { scenarioPopupAccessSaysWhy } from './e2e/scenario-popup-access-says-why';
import { scenarioPopupBacklogFull } from './e2e/scenario-popup-backlog-full';
import { scenarioPopupControlsSayWhy } from './e2e/scenario-popup-controls-say-why';
import { scenarioPopupShowFile } from './e2e/scenario-popup-show-file';
import { scenarioPresenceControls } from './e2e/scenario-presence-controls';
import { scenarioRecoveryWhileDraining } from './e2e/scenario-recovery-while-draining';
import { scenarioRefusedOnlyRemove } from './e2e/scenario-refused-only-remove';
import { scenarioRetryLostTab } from './e2e/scenario-retry-lost-tab';
import { scenarioSelfViewOnTop } from './e2e/scenario-self-view-on-top';
import { scenarioShowFileAfterRestart } from './e2e/scenario-show-file-after-restart';
import { scenarioSoak } from './e2e/scenario-soak';
import { scenarioStartNotStored } from './e2e/scenario-start-not-stored';
import { scenarioStatusCard } from './e2e/scenario-status-card';
import { scenarioStuckPainter } from './e2e/scenario-stuck-painter';
import { scenarioSubfolderExtension } from './e2e/scenario-subfolder-extension';
import { scenarioToastsInOwnTab } from './e2e/scenario-toasts-in-own-tab';
import { scenarioUniqueVideoStamps } from './e2e/scenario-unique-video-stamps';
import { scenarioUpdateMidRecording } from './e2e/scenario-update-mid-recording';
import { scenarioVideoBack } from './e2e/scenario-video-back';
import { scenarioWithoutWebRtc } from './e2e/scenario-without-webrtc';
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
  ['83', scenarioClosedConnections],
  ['46', scenarioUniqueVideoStamps],
  ['73', scenarioMeetCountsPeople],
  ['78', scenarioMediaClock],
  ['77', scenarioCameraOffAlone],
  ['50', scenarioColoursMatchTag],
  ['59', scenarioSelfViewOnTop],
  ['64', scenarioAloneSaysWaiting],
  ['63', scenarioStuckPainter],
  ['86', scenarioPresenceControls],
  ['3', scenarioRecordAlone],
  ['4', scenarioAudioOnly],
  ['6', scenarioEncoderErrorRestart],
  ['7', scenarioEncoderErrorWhilePaused],
  ['8', scenarioSameNameAtOnce],
  ['9', scenarioChunkNotStored],
  ['41', scenarioStartNotStored],
  ['44', scenarioDiskFullTold],
  ['70', scenarioToastsInOwnTab],
  ['11', scenarioRefusedFileName],
  ['65', scenarioSubfolderExtension],
  ['12', scenarioStopBeforeFirstSample],
  ['53', scenarioRefusedOnlyRemove],
  ['13', scenarioStoppedMicrophone],
  ['14', scenarioBusyPageKeepsQueuedAudio],
  ['15', scenarioEndNoticeLost],
  ['60', scenarioLogAcrossPortDrop],
  ['16', scenarioSustainedBacklog],
  ['72', scenarioBusyPageAudio],
  ['17', scenarioGuestKnocks],
  ['20', scenarioPageGoneWhileRecording],
  ['47', scenarioPageGoneTail],
  ['56', scenarioAnnouncedWhilePortDown],
  ['22', scenarioProjectNotice],
  ['45', scenarioPopupShowFile],
  ['52', scenarioRetryLostTab],
  // It runs a browser of its own, which it restarts.
  ['49', scenarioShowFileAfterRestart],
  // It runs a browser of its own, with WebRTC switched off.
  ['79', scenarioWithoutWebRtc],
  // It runs a browser of its own, which it updates from the previous release mid-recording.
  ['88', scenarioUpdateMidRecording],
  ['58', scenarioKeyboardShortcut],
  ['55', scenarioPopupControlsSayWhy],
  // It takes the services' own sites out of the permissions, which no later scenario needs.
  ['68', scenarioPopupAccessSaysWhy],
  ['33', scenarioBacklogFull],
  ['62', scenarioVideoBack],
  ['37', scenarioVideoErrorDuringOutage],
  ['40', scenarioAudioErrorDuringOutage],
  ['51', scenarioBacklogFullTold],
  ['75', scenarioPopupBacklogFull],
  ['48', scenarioStatusCard],
  ['84', scenarioCardClosedToPage],
  // It reloads the extension, as the ones after it do.
  ['38', scenarioChunkBookkeeping],
  ['43', scenarioRecoveryWhileDraining],
  ['5', scenarioExtensionReload],
  ['2', scenarioRecoveryOnTabClose],
  ['25', scenarioCrashWhileChunkStored],
  // Last: it reloads the extension twice.
  ['10', scenarioInterruptionNotStored],
];

const diagnosticsFile = (target: FixtureTarget): string =>
  path.join(E2E_DIR, `diagnostics-${target.id}.json`);

/** Run only when `E2E_SCENARIOS` names them: too long for every run. */
const ON_REQUEST: typeof SCENARIOS = [
  // One recording of SOAK_MINUTES minutes (`pnpm soak`, the weekly Soak workflow).
  ['92', scenarioSoak],
];

function selectScenarios(): typeof SCENARIOS {
  const wanted = (process.env['E2E_SCENARIOS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (wanted.length === 0) return SCENARIOS;
  return [...SCENARIOS, ...ON_REQUEST].filter(([name]) => wanted.includes(name));
}

/**
 * One browser per provider, so a provider's leftovers cannot influence the next one. `progress`
 * names the scenario running, so a failure can say which one it was.
 */
async function runTarget(
  target: FixtureTarget,
  progress: { scenario: FailedScenario | null },
): Promise<void> {
  console.log(`\n━━ ${target.label} ━━`);
  const browser = await launch();
  try {
    const id = await browser.installExtension(EXTENSION_DIR);
    console.log(`extension installed: ${id}`);
    await assertAudioWorks(browser, meetingUrl(target));
    const context = { browser, target };
    for (const [name, scenario] of selectScenarios()) {
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
  if (!existsSync(EXTENSION_DIR)) throw new Error(`build first: ${EXTENSION_DIR} missing`);
  if (!existsSync(FIREFOX)) throw new Error(`run pnpm setup:firefox first: ${FIREFOX} missing`);
  const { run, skipped } = selectTargets();
  for (const target of skipped) console.log(`⚠ ${target.label}: no fixture page yet, skipped`);
  if (run.length === 0) throw new Error('no provider to test');
  // Before any scenario relies on them: the audio measures read the span they are given.
  assertAudioMeasuresWork();
  console.log('audio measures: ok (they read the seconds before a late first video frame)');
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  await Promise.all(run.map((target) => rm(diagnosticsFile(target), { force: true })));
  console.log(`audio server: ${selectAudioServer()}`);
  const server = await startFixtureServer(PORT);
  const failures: string[] = [];
  for (const target of run) {
    const progress: { scenario: FailedScenario | null } = { scenario: null };
    try {
      await runTarget(target, progress);
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
