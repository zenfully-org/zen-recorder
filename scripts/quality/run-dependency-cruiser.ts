/**
 * Cruises src and scripts with .dependency-cruiser.cjs and returns the imports that break its
 * rules: circular imports, and local imports dependency-cruiser cannot resolve (it would not see a
 * cycle through them). dependency-cruiser walks the folders itself and does not read git's ignore
 * files, so what starts in a file git does not list (a scratch folder in .git/info/exclude) is left
 * out, as the other checks leave such files out.
 */
import { parseDependencyCruiserReport } from './parse-dependency-cruiser-report';
import type { ImportViolation } from './types';

export interface DependencyCruiserDeps {
  /** Cruises these folders, relative to the root, with .dependency-cruiser.cjs; its JSON report. */
  cruise: (paths: string[]) => Promise<string>;
  /** Whether git lists the file (tracked, or new and not ignored); a path relative to the root. */
  isListed: (file: string) => boolean;
}

export async function runDependencyCruiser(
  deps: DependencyCruiserDeps,
): Promise<ImportViolation[]> {
  let report: string;
  try {
    report = await deps.cruise(['src', 'scripts']);
  } catch (error) {
    throw new Error(
      `dependency-cruiser failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseDependencyCruiserReport(report).filter((violation) => deps.isListed(violation.from));
}
