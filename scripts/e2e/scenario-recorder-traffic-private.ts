/**
 * Scenario 87: a script of the meeting page listens on its window while the recorder records,
 * pauses, resumes and stops → it hears none of the recorder's traffic; and a script that connects
 * to the recorder after the bridge did, then asks it to stop, on that port and on the window, stops
 * nothing: the recording goes on and saves whole.
 *
 * The recorder runs in the page's own world. It talked to the extension's content script with
 * `window.postMessage`, so every `message` listener of the page received the chunks, the
 * snapshots and the settings, and any script could post the recorder a Stop. Now the content
 * script hands the recorder a private `MessagePort` in an event the recorder stops before the
 * page's listeners, and the recorder keeps the bridge it has while that bridge answers.
 */
import path from 'node:path';
import { getAddOnId } from '../../src/lib/get-add-on-id';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  recordingStarted,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const NS = getAddOnId();
/** Longer than the recorder's check of the bridge it has (2 s). */
const INTRUSION_MS = 3_000;

export async function scenarioRecorderTrafficPrivate({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 87: the page listens to its window while the recorder records, and a page script connects and asks for a Stop → it hears nothing, stops nothing, and the file saves whole`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  // The page's own listeners, added by a script of the page once the recorder runs.
  await page.evaluate((ns) => {
    const heard: string[] = [];
    window.__e2eHeard = heard;
    window.addEventListener('message', (event) => {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || !('ns' in data) || data.ns !== ns) return;
      // What the page script below posts itself is the page's, not the recorder's.
      if ('id' in data && String(data.id).startsWith('intruder:')) return;
      heard.push('type' in data ? `message ${String(data.type)}` : 'message');
    });
    for (const name of ['connect', 'recorder-ready', 'page:handover', 'bridge:handover']) {
      window.addEventListener(`${ns}:${name}`, (event) => heard.push(event.type), {
        capture: true,
      });
    }
  }, NS);
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  const startedAt = Date.now();
  for (const button of ['Pause', 'Resume']) {
    await page.evaluate((name) => {
      if (!window.__fixture.clickOverlay(name)) throw new Error(`no ${name} button`);
    }, button);
    await sleep(1_000);
  }
  const heardWhileRecording = await page.evaluate(() => [...new Set(window.__e2eHeard ?? [])]);
  console.log(
    `  while recording, the page's own listeners heard: ${heardWhileRecording.join(', ') || 'nothing'}`,
  );
  // A script of the page connects with a port of its own, then asks for a Stop on it and on the
  // window, the way the recorder's messages used to look.
  const intrusion = await page.evaluate(
    async (ns, waitMs) => {
      const channel = new MessageChannel();
      const received: unknown[] = [];
      channel.port1.onmessage = (event) => received.push(event.data);
      const taken = !window.dispatchEvent(
        new CustomEvent(`${ns}:connect`, { detail: channel.port2, cancelable: true }),
      );
      const stop = { ns, kind: 'req', type: 'bridge:command', data: { command: 'stop' } };
      channel.port1.postMessage({ ...stop, id: 'intruder:1' });
      window.postMessage({ ...stop, id: 'intruder:2' }, location.origin);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return { taken, received: received.length };
    },
    NS,
    INTRUSION_MS,
  );
  const stateAfterIntrusion = await overlayState(page);
  console.log(
    `  intruder: its connect ${intrusion.taken ? 'was taken' : 'went unanswered'}, it received ${intrusion.received} message(s), and the card says ${stateAfterIntrusion ?? 'nothing'}`,
  );
  if (stateAfterIntrusion !== 'recording') {
    await page.close();
    throw new Error(
      `a page script stopped the recording: the card says ${stateAfterIntrusion ?? 'nothing'} after its Stop`,
    );
  }
  await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
  });
  const stoppedAt = Date.now();
  const file = await waitForNewRecording(before);
  const heard = await page.evaluate(() => window.__e2eHeard ?? []);
  await page.close();
  const info = await inspectWebm(file);
  const fresh = (await listWebm()).filter((saved) => !before.has(saved));
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `  the page's own listeners heard ${heard.length} message(s) or event(s) of the recorder${heard.length > 0 ? `: ${[...new Set(heard)].join(', ')}` : ''}`,
  );
  if (heard.length > 0) {
    throw new Error(`the page heard the recorder's traffic: ${[...new Set(heard)].join(', ')}`);
  }
  if (intrusion.received > 0) {
    throw new Error(`a page script that connected received ${intrusion.received} message(s)`);
  }
  if (fresh.length !== 1) throw new Error(`expected one file, got ${fresh.length}`);
  if (info.tracks !== 2) throw new Error(`expected 2 tracks, got ${info.tracks}`);
  // The pause takes out one second of the time between Record and Stop.
  const expectedS = (stoppedAt - startedAt) / 1000 - 1;
  if (!(info.durationS > expectedS - 1.5)) {
    throw new Error(
      `the file is short: ${info.durationS} s for ${expectedS.toFixed(1)} s recorded`,
    );
  }
}
