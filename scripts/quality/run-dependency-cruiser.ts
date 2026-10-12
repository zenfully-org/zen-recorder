/**
 * Checks the imports of the files git lists under src and scripts with .dependency-cruiser.cjs and
 * returns those that break its rules: circular imports, and local imports dependency-cruiser cannot
 * resolve (it would not see a cycle through them). dependency-cruiser gets the files, never the
 * folders: it walks a folder without reading git's ignore files, so it read every file of a folder
 * git ignores (a scratch folder, copies of a built extension), and a few dozen builds there ran it
 * out of memory. A file git does not list is read only when a listed file imports it.
 */
import { parseDependencyCruiserReport } from './parse-dependency-cruiser-report';
import type { ImportViolation } from './types';

export interface DependencyCruiserDeps {
  /** Cruises these files, relative to the root, with .dependency-cruiser.cjs; its JSON report. */
  cruise: (files: string[]) => Promise<string>;
}

/** The folders whose imports the check follows. */
const CHECKED = /^(?:src|scripts)\//;

/** `files`: what git tracks or would add (`listProjectFiles`), relative to the root. */
export async function runDependencyCruiser(
  deps: DependencyCruiserDeps,
  files: string[],
): Promise<ImportViolation[]> {
  let report: string;
  try {
    report = await deps.cruise(files.filter((file) => CHECKED.test(file)));
  } catch (error) {
    throw new Error(
      `dependency-cruiser failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseDependencyCruiserReport(report);
}
