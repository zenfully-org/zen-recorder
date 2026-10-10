/**
 * E2e scenario 79, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * recorder runs in a browser where WebRTC is switched off.
 *
 * With `media.peerconnection.enabled` false (a common privacy setting in Firefox and Zen), the
 * browser defines no `RTCPeerConnection`. The recorder wrapped it in a Proxy without looking, and
 * the TypeError at `document_start` stopped the page's recorder before it started: no status card
 * state, no microphone, no recording.
 *
 * The scenario runs a browser of its own with that pref off. On every fixture page the recorder
 * must run and hear the microphone the page asks for when joining. Zoom's web client holds a call
 * without WebRTC (over WebSockets); on a fake page that models it (`joinsWithoutWebRtc`) the
 * scenario records the call and checks that the file has its video, the microphone (1 kHz) and
 * the other participant (440 Hz). Where the real service needs WebRTC to call at all, the fake
 * page's join stops after the microphone, as the service's would.
 */
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import {
  assertAudioWorks,
  currentRecordingId,
  describeWebm,
  EXTENSION_DIR,
  inspectWebm,
  launch,
  listWebm,
  openMeeting,
  sleep,
  toneLevel,
  waitFor,
  waitForExtensionReady,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** Firefox's fake microphone plays a 1 kHz tone; the fixtures' remote participants send 440 Hz. */
const MIC_TONE_HZ = 1000;
const REMOTE_TONE_HZ = 440;
/** Both tones are recorded far louder than this; a missing source is below -90 dBFS. */
const TONE_FLOOR_DB = -40;

const recorderSnapshot = (page: Page) =>
  page.evaluate(() => window.__zenRecorderPage?.snapshot() ?? null);

/** Records a few seconds of the call, stops, and returns what is wrong with the saved file. */
async function recordCall(page: Page): Promise<string[]> {
  const before = new Set(await listWebm());
  await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  const to = info.durationS - 0.5;
  const mic = toneLevel(file, MIC_TONE_HZ, 1, to);
  const remote = toneLevel(file, REMOTE_TONE_HZ, 1, to);
  console.log(
    `  microphone ${mic.toFixed(1)} dBFS, the other participant ${remote.toFixed(1)} dBFS`,
  );
  return [
    ...(info.video && info.video.frames > 0 ? [] : ['the file has no video']),
    ...(mic > TONE_FLOOR_DB ? [] : [`the microphone is silent in the file: ${mic} dBFS`]),
    ...(remote > TONE_FLOOR_DB ? [] : [`the other participant is silent: ${remote} dBFS`]),
  ];
}

async function runWithoutWebRtc(browser: Browser, target: FixtureTarget): Promise<string[]> {
  await assertAudioWorks(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  const webRtc = await page.evaluate(() => typeof window.RTCPeerConnection);
  console.log(`  RTCPeerConnection in the page: ${webRtc}`);
  if (webRtc !== 'undefined') throw new Error(`the pref left WebRTC on: ${webRtc}`);
  const idle = await recorderSnapshot(page);
  console.log(`  the page's recorder: ${idle ? `runs (${idle.state})` : 'not running'}`);
  if (!idle) return ['the recorder is not running in the page'];
  await page.click('#start');
  const micLabel = await waitFor(
    'the recorder hears the microphone',
    async () => (await recorderSnapshot(page))?.micLabel ?? null,
    10_000,
  );
  console.log(`  the recorder hears the microphone: ${micLabel}`);
  const problems = target.joinsWithoutWebRtc ? await recordCall(page) : [];
  await page.close();
  return problems;
}

export async function scenarioWithoutWebRtc({ target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 79: WebRTC switched off → the recorder runs, hears the microphone${target.joinsWithoutWebRtc ? ' and records the call' : ''}`,
  );
  const browser = await launch({ prefs: { 'media.peerconnection.enabled': false } });
  try {
    await browser.installExtension(EXTENSION_DIR);
    await waitForExtensionReady(browser, meetingUrl(target));
    const problems = await runWithoutWebRtc(browser, target);
    if (problems.length > 0) throw new Error(problems.join('; '));
  } finally {
    await browser.close();
  }
}
