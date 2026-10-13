/**
 * The e2e run order, from the scenarios that register themselves: every
 * `scripts/e2e/scenario-<name>.ts` exports `registration = { name, after, scenario }`, so adding a
 * scenario adds a file and edits no list that another pull request edits too. A scenario runs
 * right after the scenario `after` names, and `after: 'start'` is the beginning of the run. When
 * several name the same scenario, each runs followed by the scenarios that name it, in the order
 * of their names, numbers by value, except that the ones followed by the longest chain run last:
 * that chain is the rest of the run, and a scenario added after the same one does not wait for it.
 * A scenario too long for every run registers `{ name, onRequest: true, scenario }` and runs only
 * when `E2E_SCENARIOS` names it.
 *
 * A name that is taken (by another file, or "start"), an `after` that names no scenario of the run
 * (an on-request one included), and registrations that name each other fail before the first
 * scenario, with the file to fix.
 */
import type { Browser } from 'puppeteer';
import type { FixtureTarget } from './targets';

/** What every scenario gets: the browser of its service's run, and that service's fake page. */
export interface ScenarioContext {
  browser: Browser;
  target: FixtureTarget;
}

export type Scenario = (context: ScenarioContext) => Promise<void>;

/**
 * What a scenario file exports as `registration` (`satisfies ScenarioRegistration`): `name` is
 * what `E2E_SCENARIOS` selects it by, and what a failure names; `after` the scenario it runs right
 * after (`'start'`: the run's first); `onRequest` in place of `after` keeps it out of the run
 * unless `E2E_SCENARIOS` names it.
 */
export type ScenarioRegistration = { name: string; scenario: Scenario } & (
  | { after: string }
  | { onRequest: true }
);

/** A registration and the file it came from, relative to the repository's root. */
export type FoundRegistration = ScenarioRegistration & { file: string };

export interface ScenarioOrder {
  /** Every scenario of a run, in run order. */
  run: [string, Scenario][];
  /** The scenarios that run only when `E2E_SCENARIOS` names them, in the order of their names. */
  onRequest: [string, Scenario][];
}

/** Where the run begins: `after: 'start'`. No scenario may take the name. */
const START = 'start';

type Placed = FoundRegistration & { after: string };

const isPlaced = (registration: FoundRegistration): registration is Placed =>
  'after' in registration;

const byName = (a: FoundRegistration, b: FoundRegistration) =>
  a.name.localeCompare(b.name, 'en', { numeric: true });

/** Fails on a name an earlier file has taken, or on "start". */
function claimNames(registrations: FoundRegistration[]): void {
  const owners = new Map<string, string>();
  for (const { file, name } of registrations) {
    if (name === START) {
      throw new Error(
        `${file}: a scenario may not be named "${START}": \`after: '${START}'\` means the beginning of the run`,
      );
    }
    const owner = owners.get(name);
    if (owner !== undefined) {
      throw new Error(`${file}: scenario "${name}" is registered twice, also in ${owner}`);
    }
    owners.set(name, file);
  }
}

export function orderScenarios(registrations: FoundRegistration[]): ScenarioOrder {
  claimNames(registrations);
  const placed = registrations.filter(isPlaced);
  const inRun = new Set([START, ...placed.map(({ name }) => name)]);
  const following = new Map<string, Placed[]>();
  for (const registration of placed) {
    const { file, name, after } = registration;
    if (!inRun.has(after)) {
      throw new Error(
        `${file}: scenario "${name}" runs after "${after}", which no scenario of the run is named`,
      );
    }
    following.set(after, [...(following.get(after) ?? []), registration]);
  }
  // Each scenario is in the run once at most, so the scenarios reached from "start" form a tree.
  const chainLength = (name: string): number =>
    1 + (following.get(name) ?? []).reduce((sum, next) => sum + chainLength(next.name), 0);
  const run: [string, Scenario][] = [];
  const place = (name: string): void => {
    const next = following.get(name) ?? [];
    const lengths = new Map(next.map(({ name: each }) => [each, chainLength(each)]));
    const longest = Math.max(...lengths.values());
    const last = (registration: Placed) => Number(lengths.get(registration.name) === longest);
    for (const registration of next.toSorted((a, b) => last(a) - last(b) || byName(a, b))) {
      run.push([registration.name, registration.scenario]);
      place(registration.name);
    }
  };
  place(START);
  const inOrder = new Set(run.map(([name]) => name));
  const loop = placed.find(({ name }) => !inOrder.has(name));
  if (loop !== undefined) {
    throw new Error(
      `${loop.file}: scenario "${loop.name}" runs after "${loop.after}", which runs after it: a loop`,
    );
  }
  const onRequest = registrations
    .filter((registration) => !isPlaced(registration))
    .sort(byName)
    .map(({ name, scenario }): [string, Scenario] => [name, scenario]);
  return { run, onRequest };
}
