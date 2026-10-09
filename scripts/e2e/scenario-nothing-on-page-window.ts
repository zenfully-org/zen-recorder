/**
 * Scenario 80: a meeting page that records looks for the recorder on its window → it finds no
 * global of zod's, no symbol and nothing that reaches the page session, and the settings it puts
 * where zod looks for them never reach the recorder's parsers. The hook scripts run in the page's
 * own world: what they leave on the window, the page's scripts can read and change. zod kept its
 * settings there (a post-processor set there was handed every schema the recorder built), and the
 * page session kept itself under a registered symbol, from which the page could stop it. The test
 * build's own handle, `__zenRecorderPage`, which a release build leaves out, is the one exception;
 * this scenario uses it to make the recorder's zod build a schema.
 */
import path from 'node:path';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  recordingStarted,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

export async function scenarioNothingOnPageWindow({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 80: a recording page looks for the recorder on its window → no zod global, no symbol, and zod settings it sets never reach the recorder`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  const found = await page.evaluate(() => ({
    zodGlobals: Object.getOwnPropertyNames(window).filter((name) => name.startsWith('__zod_')),
    symbols: Object.getOwnPropertySymbols(window).map(String),
    sessionMarker: Symbol.for('zen-recorder.page-session') in window,
  }));
  // A page's own zod would read its settings there: the page sets a post-processor, which zod
  // hands every schema it builds, then has the recorder's zod build one.
  const postProcessorCalls = await page.evaluate(
    (bytes) => {
      const existing: unknown = Reflect.get(window, '__zod_globalConfig');
      const config = typeof existing === 'object' && existing !== null ? existing : {};
      let calls = 0;
      Reflect.set(config, 'postProcessor', () => {
        calls += 1;
      });
      Reflect.set(window, '__zod_globalConfig', config);
      window.__zenRecorderPage?.setBacklogLimit?.(bytes);
      Reflect.deleteProperty(config, 'postProcessor');
      return calls;
    },
    64 * 2 ** 20,
  );
  console.log(
    `  on the window: zod globals [${found.zodGlobals.join(', ')}], symbols [${found.symbols.join(', ')}], session marker ${found.sessionMarker}; the page's zod post-processor called ${postProcessorCalls} time(s)`,
  );
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  await page.close();
  const problems = [
    ...found.zodGlobals.map((name) => `zod's ${name}`),
    ...found.symbols.map((symbol) => `the symbol ${symbol}`),
    ...(found.sessionMarker ? ['the page session under Symbol.for'] : []),
    ...(postProcessorCalls > 0
      ? [`zod settings the page set, used ${postProcessorCalls} time(s) by the recorder`]
      : []),
  ];
  if (problems.length > 0) {
    throw new Error(`the page found the recorder on its window: ${problems.join(' · ')}`);
  }
}
