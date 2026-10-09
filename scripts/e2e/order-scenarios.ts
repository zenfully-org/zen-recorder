/**
 * The e2e run order: the list in `scripts/e2e-fixture.ts`, with the scenarios that register
 * themselves merged in. A scenario file registers itself by exporting
 * `registration = { name, after, scenario }`, so adding a scenario adds a file and edits no list
 * that another pull request edits too. It runs right after the scenario `after` names (a listed one
 * or another registered one); several that name the same scenario run in the order of their names,
 * numbers by value. A name that is taken (by the list, by the scenarios run only on request or by
 * another file), an `after` that names no scenario of the run, and registrations that name each
 * other fail before the first scenario, with the file to fix.
 */
import type { ScenarioContext } from './scenarios';

export type Scenario = (context: ScenarioContext) => Promise<void>;

/**
 * What a scenario file exports as `registration` (`satisfies ScenarioRegistration`).
 * @public for the scenario files, which the run finds by listing the folder
 */
export interface ScenarioRegistration {
  /** What `E2E_SCENARIOS` selects it by, and what a failure names. */
  name: string;
  /** The scenario it runs right after. */
  after: string;
  scenario: Scenario;
}

/** A registration and the file it came from, relative to the repository's root. */
export interface FoundRegistration extends ScenarioRegistration {
  file: string;
}

const LIST = 'the list of scripts/e2e-fixture.ts';

const byName = (a: FoundRegistration, b: FoundRegistration) =>
  a.name.localeCompare(b.name, 'en', { numeric: true });

/** Fails on a name the list, the scenarios run on request or an earlier file has taken. */
function claimNames(listed: string[], registrations: FoundRegistration[]): void {
  const owners = new Map(listed.map((name) => [name, LIST]));
  for (const { file, name } of registrations) {
    const owner = owners.get(name);
    if (owner !== undefined) {
      throw new Error(`${file}: scenario "${name}" is registered twice, also in ${owner}`);
    }
    owners.set(name, file);
  }
}

export function orderScenarios(
  list: [string, Scenario][],
  registrations: FoundRegistration[],
  onRequest: [string, Scenario][],
): [string, Scenario][] {
  claimNames(
    [...list, ...onRequest].map(([name]) => name),
    registrations,
  );
  const inRun = new Set([...list.map(([name]) => name), ...registrations.map(({ name }) => name)]);
  const following = new Map<string, FoundRegistration[]>();
  for (const registration of registrations) {
    const { file, name, after } = registration;
    if (!inRun.has(after)) {
      throw new Error(
        `${file}: scenario "${name}" runs after "${after}", which no scenario of the run is named`,
      );
    }
    following.set(after, [...(following.get(after) ?? []), registration].sort(byName));
  }
  const ordered: [string, Scenario][] = [];
  const place = (entry: [string, Scenario]): void => {
    ordered.push(entry);
    for (const next of following.get(entry[0]) ?? []) place([next.name, next.scenario]);
  };
  for (const entry of list) place(entry);
  const placed = new Set(ordered.map(([name]) => name));
  const loop = registrations.find(({ name }) => !placed.has(name));
  if (loop !== undefined) {
    throw new Error(
      `${loop.file}: scenario "${loop.name}" runs after "${loop.after}", which runs after it: a loop`,
    );
  }
  return ordered;
}
