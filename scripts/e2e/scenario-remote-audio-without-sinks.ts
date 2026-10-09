/**
 * Scenario 91: the recorder takes the remote participant's audio through its audio graph alone →
 * it plays no media element of its own, and the remote audio is in the file even once the page
 * stops playing it. Firefox feeds a remote WebRTC track into a `MediaStreamAudioSourceNode`
 * whether or not an element plays it: the media graph pulls the track's audio while its
 * transceiver receives, and the source node takes it from the graph. The mixer used to play
 * every track it mixed on a muted `<audio>` element, which some other engines need, and which
 * the page could see.
 *
 * A script of the page notes every `<audio>` element played with a stream, and whether the
 * recorder played it: in a stack the page reads, Firefox names the frames of a MAIN-world content
 * script `<anonymous code>`, and the fake page's own frames by its URL. On the Meet and Teams pages,
 * whose remote audio is a WebRTC track, the page then stops its own elements, so the recorder's
 * graph is the track's only consumer. On Zoom's, the element is how the remote audio exists at
 * all, and the recorder captures what it plays: it keeps playing.
 */
import path from 'node:path';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  recordingStarted,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The remote side's tone (`fake-peer.html`, and the Zoom page's own). */
const REMOTE_TONE_HZ = 440;
/** The tone through the mixer sits around -15 dBFS; the band without it stays below -55. */
const TONE_FLOOR_DB = -40;

export async function scenarioRemoteAudioWithoutSinks({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 91: the remote audio reaches the file through the recorder's audio graph alone, with no media element of the recorder's`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  // No named function inside the page: tsx would wrap it in a helper the page lacks.
  await page.evaluate(() => {
    const played: { byRecorder: boolean; element: HTMLAudioElement }[] = [];
    Reflect.set(window, '__e2ePlayed', played);
    const play = HTMLMediaElement.prototype.play;
    const descriptor: PropertyDescriptor = { configurable: true, writable: true };
    descriptor.value = function (this: HTMLMediaElement, ...args: unknown[]) {
      if (this instanceof HTMLAudioElement && this.srcObject instanceof MediaStream) {
        // The first frame is this function's own.
        const callers = (new Error().stack ?? '').split('\n').slice(1).join('\n');
        const byRecorder = callers.includes('<anonymous code>');
        played.push({ byRecorder, element: this });
      }
      return Reflect.apply(play, this, args);
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'play', descriptor);
  });
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  const startedAt = Date.now();
  await sleep(3_000);
  const stoppedByPage =
    target.id === 'zoom'
      ? 0
      : await page.evaluate(() => {
          const played: unknown = Reflect.get(window, '__e2ePlayed');
          if (!Array.isArray(played)) return 0;
          let stopped = 0;
          for (const entry of played) {
            if (entry.byRecorder || !(entry.element instanceof HTMLAudioElement)) continue;
            entry.element.pause();
            entry.element.srcObject = null;
            stopped += 1;
          }
          return stopped;
        });
  const pageQuietFromS = (Date.now() - startedAt) / 1000;
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  const sinks = await page.evaluate(() => {
    const played: unknown = Reflect.get(window, '__e2ePlayed');
    return Array.isArray(played) ? played.filter((entry) => entry.byRecorder === true).length : 0;
  });
  await page.close();
  const info = await inspectWebm(file);
  const level = toneLevel(file, REMOTE_TONE_HZ, pageQuietFromS + 1, pageQuietFromS + 3);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `  elements the recorder played: ${sinks}; elements of the page stopped: ${stoppedByPage}; remote tone ${level.toFixed(1)} dBFS from ${(pageQuietFromS + 1).toFixed(1)} s`,
  );
  if (sinks > 0) throw new Error(`the recorder played ${sinks} media element(s) of its own`);
  if (!(level > TONE_FLOOR_DB)) {
    throw new Error(
      `the remote tone is missing from the file (${level.toFixed(1)} dBFS, expected above ${TONE_FLOOR_DB})`,
    );
  }
}
