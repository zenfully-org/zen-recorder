/**
 * E2e scenario 86, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * fixture's people and share controls change the page the way the service would, and the
 * provider reads them back.
 *
 * Meeting notes need to know who is in the call and who shares, so every fake page lets a run add
 * and remove people (with the camera on or off), start and stop a share by any of them, and share
 * the user's own screen from a click. Each step must show in the provider's reading of the page
 * (`__zenRecorderPage.debug().presence`, names left out): as many people as the page shows, the
 * user marked where the service marks them, the page's count where it counts, and a share and its
 * sharer where the service shows them. A share is never a person of its own, and the user's own
 * share starts from a click.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { expectEventually } from './expect-eventually';
import { listWebm, openMeeting, waitFor, waitForNewRecording } from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** A test build's `debug()`: `presence` is missing where the build has none. */
const debugSchema = z.object({
  presence: z
    .object({
      participants: z.array(
        z.object({ name: z.number().nullable(), self: z.boolean().nullable() }),
      ),
      count: z.number().nullable(),
      share: z.object({ kind: z.string(), name: z.number().nullable().optional() }),
      selfMic: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

type Presence = z.infer<typeof debugSchema>['presence'];

const EXTRA = 'Extra Person';
const CAMERA_OFF = 'Camera Off Person';

/** A reading in one line, names left out: what the steps compare. */
function describePresence(presence: Presence): string {
  if (!presence) return 'no call';
  const { participants, count, share } = presence;
  const selves = participants.filter((person) => person.self === true).length;
  const sharer = share.kind === 'active' ? `:${share.name ?? 'unnamed'}` : '';
  return `people=${participants.length} self=${selves} count=${count} share=${share.kind}${sharer}`;
}

/** The share the provider must read: on a page that does not name the sharer, none it can read. */
function expectedShare(target: FixtureTarget, sharer: string | null): string {
  if (!target.supports.shareBy) return 'unknown';
  return sharer === null ? 'none' : `active:${sharer.length}`;
}

/** What the provider must read with `people` in the call, the user included. */
function expected(target: FixtureTarget, people: number, sharer: string | null): string {
  const { supports } = target;
  const count = supports.count ? people : null;
  const share = expectedShare(target, sharer);
  return `people=${people} self=${supports.self ? 1 : 0} count=${count} share=${share}`;
}

const readPresence = async (page: Page): Promise<Presence> =>
  debugSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.debug() ?? {})).presence;

async function step(
  page: Page,
  target: FixtureTarget,
  label: string,
  want: { people: number; sharer: string | null },
): Promise<void> {
  const read = async () => describePresence(await readPresence(page));
  await expectEventually(label, read, expected(target, want.people, want.sharer), 10_000, 250);
  const presence = await readPresence(page);
  console.log(`  ${label}: ${describePresence(presence)} mic=${presence?.selfMic ?? null}`);
}

export async function scenarioPresenceControls({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 86: people join, leave and share on the fixture page → the provider reads each step`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const { remote } = target.names;
  await step(page, target, 'in the call', { people: 2, sharer: null });
  const names = await page.evaluate(() => window.__fixture.participants());
  if (names.self !== target.names.self || names.others.join() !== remote) {
    throw new Error(
      `the fixture names ${JSON.stringify(names)}, not ${JSON.stringify(target.names)}`,
    );
  }

  await page.evaluate((name) => window.__fixture.addParticipant({ name }), EXTRA);
  await step(page, target, 'someone joins', { people: 3, sharer: null });
  await page.evaluate(
    (name) => window.__fixture.addParticipant({ name, camera: false }),
    CAMERA_OFF,
  );
  await step(page, target, 'someone joins with the camera off', { people: 4, sharer: null });
  await page.evaluate((name) => window.__fixture.removeParticipant(name), EXTRA);
  await step(page, target, 'someone leaves', { people: 3, sharer: null });

  await page.evaluate((name) => window.__fixture.startShare(name), remote);
  await step(page, target, 'the remote participant shares', { people: 3, sharer: remote });
  await page.evaluate(() => window.__fixture.stopShare());
  await step(page, target, 'the share ends', { people: 3, sharer: null });

  if (target.supports.selfShare) {
    // A real click: Firefox starts a share only from one.
    await page.click('#share-screen');
    await waitFor(
      'the own share',
      () => page.evaluate(() => window.__fixture.sharingScreen()),
      10_000,
    );
    await step(page, target, 'the user shares a screen', { people: 3, sharer: null });
    await page.evaluate(() => window.__fixture.stopScreenShare());
  }
  // The call started a recording: end it here, so that no later scenario finds it saving.
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  await waitForNewRecording(before);
  await page.close();
}
