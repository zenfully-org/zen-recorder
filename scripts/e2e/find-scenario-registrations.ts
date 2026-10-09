/**
 * Finds the scenarios that register themselves: every `scripts/e2e/scenario-<name>.ts` is loaded,
 * and the ones that export `registration = { name, after, scenario }` are returned with their
 * file, in file-name order (`orderScenarios` places them). The files the list in
 * `scripts/e2e-fixture.ts` names export no registration and are skipped. A registration's name is
 * what `E2E_SCENARIOS` selects it by, so it is letters, digits and dashes only.
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

/** A module without `registration` is a scenario the list names. */
const moduleSchema = z.object({
  registration: z
    .object({
      name: z.string().regex(/^[A-Za-z0-9-]+$/),
      after: z.string().min(1),
      scenario: z.custom<Scenario>(isScenario),
    })
    .optional(),
});

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
    const parsed = moduleSchema.safeParse(await deps.load(file));
    if (!parsed.success) {
      throw new Error(`${where}: its registration is not { name, after, scenario }`);
    }
    const { registration } = parsed.data;
    if (registration !== undefined) found.push({ file: where, ...registration });
  }
  return found;
}
