/**
 * E2e scenario 13, run against every provider's fixture page: the page stops a microphone, which
 * fires no event (Teams' permission probe on load, a microphone test next to the call's microphone)
 * → no microphone named before joining, and the call's microphone recorded after the test as loud
 * as before it.
 */
import path from 'node:path';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  pressCardButton,
  recordingStarted,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

declare module './harness' {
  interface FixtureApi {
    /**
     * A settings dialog's microphone test: opens a second microphone next to the call's and stops
     * it (no event) after `holdMs`, 2 s by default. Resolves once it is stopped.
     */
    micTest(holdMs?: number): Promise<void>;
  }
}

/** Firefox's fake microphone plays a 1 kHz tone; the fixtures' remote participants send 440 Hz. */
const MIC_TONE_HZ = 1000;

export async function scenarioStoppedMicrophone({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 13: a microphone the page stopped (no event) is not the one recorded`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const snapshot = () => page.evaluate(() => window.__zenRecorderPage?.snapshot());
  // The Teams fixture opens the microphone on load and stops it at once, as Teams does.
  await sleep(1_500);
  const labelBeforeJoin = (await snapshot())?.micLabel ?? null;
  console.log(`  microphone named before joining: ${JSON.stringify(labelBeforeJoin)}`);
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 30_000);
  const startedAt = (await snapshot())?.recordingStartedAt;
  if (!startedAt) throw new Error('the recording has no start time');
  await sleep(4_000);
  const testStarted = Date.now();
  await page.evaluate(() => window.__fixture.micTest());
  const testEnded = Date.now();
  await sleep(6_000);
  const labelAfterTest = (await snapshot())?.micLabel ?? null;
  console.log(`  microphone named after the test: ${JSON.stringify(labelAfterTest)}`);
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  const at = (ms: number) => (ms - startedAt) / 1000;
  const windows = {
    'before the test': [1, at(testStarted) - 0.5],
    'during the test': [at(testStarted) + 0.5, at(testEnded) - 0.5],
    'after the test': [at(testEnded) + 1, info.durationS - 0.5],
  } satisfies Record<string, [number, number]>;
  const levels = Object.fromEntries(
    Object.entries(windows).map(([name, [from, to]]) => [
      name,
      toneLevel(file, MIC_TONE_HZ, from, to),
    ]),
  );
  for (const [name, [from, to]] of Object.entries(windows)) {
    console.log(
      `  microphone ${name} (${from.toFixed(1)}-${to.toFixed(1)} s): ${levels[name]?.toFixed(1)} dBFS`,
    );
  }
  const problems: string[] = [];
  if (labelBeforeJoin !== null) {
    problems.push(`a stopped microphone is named before joining: ${labelBeforeJoin}`);
  }
  if (labelAfterTest === null) problems.push('no microphone named after the test');
  const beforeTest = levels['before the test'] ?? Number.NEGATIVE_INFINITY;
  const afterTest = levels['after the test'] ?? Number.NEGATIVE_INFINITY;
  if (!(beforeTest > -40)) problems.push(`microphone silent before the test: ${beforeTest} dBFS`);
  if (!(afterTest > beforeTest - 6)) {
    problems.push(`microphone at ${afterTest} dBFS after the test, ${beforeTest} dBFS before it`);
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
  await page.close();
}

export const registration = {
  name: '13',
  after: '53',
  scenario: scenarioStoppedMicrophone,
} satisfies ScenarioRegistration;
