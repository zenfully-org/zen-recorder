/**
 * Finds the scenarios of the e2e run: every `scripts/e2e/scenario-<name>.ts` is loaded, and the
 * `registration` it exports, `{ name, after, scenario }` or `{ name, onRequest: true, scenario }`,
 * is returned with its file, in file-name order (`orderScenarios` places them). A scenario file
 * without one fails: no run would ever run its scenario. A registration's name is what
 * `E2E_SCENARIOS` selects it by, so it is letters, digits and dashes only.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { FoundRegistration, Scenario } from './order-scenarios';

export interface FindScenarioRegistrationsDeps {
  /** The names of the files in `scripts/e2e/`. */
  listFiles: () => Promise<string[]>;
  /** The module a file of that folder exports. */
  load: (file: string) => Promise<unknown>;
}

const SCENARIO_FILE = /^scenario-[a-z0-9-]+\.ts$/;

const isScenario = (value: unknown): value is Scenario => typeof value === 'function';

const named = {
  name: z.string().regex(/^[A-Za-z0-9-]+$/),
  scenario: z.custom<Scenario>(isScenario),
};

const registrationSchema = z.union([
  z.strictObject({ ...named, after: z.string().min(1) }),
  z.strictObject({ ...named, onRequest: z.literal(true) }),
]);

const FOLDER = import.meta.dirname;

const REAL_DEPS: FindScenarioRegistrationsDeps = {
  listFiles: () => readdir(FOLDER),
  load: (file) => import(pathToFileURL(path.join(FOLDER, file)).href),
};

export async function findScenarioRegistrations(
  deps: FindScenarioRegistrationsDeps = REAL_DEPS,
): Promise<FoundRegistration[]> {
  const files = (await deps.listFiles()).filter((file) => SCENARIO_FILE.test(file)).sort();
  const found: FoundRegistration[] = [];
  for (const file of files) {
    const where = `scripts/e2e/${file}`;
    const module = z.object({ registration: z.unknown() }).safeParse(await deps.load(file));
    if (!module.success || module.data.registration === undefined) {
      throw new Error(`${where}: exports no registration, so no run would ever run its scenario`);
    }
    const parsed = registrationSchema.safeParse(module.data.registration);
    if (!parsed.success) {
      throw new Error(
        `${where}: its registration is not { name, after, scenario } or { name, onRequest: true, scenario }`,
      );
    }
    found.push({ file: where, ...parsed.data });
  }
  return found;
}
