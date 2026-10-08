/**
 * Reads the JSON report jscpd writes (`jscpd-report.json`): every clone with both places, and
 * whether the clone baseline knew it. A run without a baseline gives no `isNew` flag; every clone
 * is new then. Paths come absolute (`--absolute`) and are made relative to the repository with
 * forward slashes, on Windows too.
 */
import { z } from 'zod';
import { relativeToRoot } from './relative-to-root';
import type { Clone } from './types';

const LOCATION = z.object({ name: z.string(), startLoc: z.object({ line: z.number().int() }) });
const REPORT = z.object({
  duplicates: z.array(
    z.object({
      lines: z.number().int(),
      isNew: z.boolean().optional(),
      firstFile: LOCATION,
      secondFile: LOCATION,
    }),
  ),
});

export function parseJscpdReport(text: string, root: string): { clones: Clone[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`the jscpd report is not JSON: ${String(error)}`);
  }
  const parsed = REPORT.safeParse(data);
  if (!parsed.success) {
    throw new Error(`the jscpd report has an unexpected shape: ${parsed.error.message}`);
  }
  return {
    clones: parsed.data.duplicates.map((clone) => ({
      lines: clone.lines,
      isNew: clone.isNew ?? true,
      first: {
        file: relativeToRoot(clone.firstFile.name, root),
        line: clone.firstFile.startLoc.line,
      },
      second: {
        file: relativeToRoot(clone.secondFile.name, root),
        line: clone.secondFile.startLoc.line,
      },
    })),
  };
}
