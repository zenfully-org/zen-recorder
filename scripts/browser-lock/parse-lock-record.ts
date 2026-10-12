/**
 * Reads the record a run writes into the browser lock file: who holds the lock, so that a run
 * that waits can say for whom, and can tell a run that ended without releasing it from one that
 * still runs. Anything else in the file (an empty file `flock` created, a file of another tool)
 * is no record: null.
 */
import { z } from 'zod';

const lockRecordSchema = z.object({
  /** Random per holder: a pid can be reused, and a lock taken again by the same pid is another. */
  token: z.string().min(1),
  pid: z.number().int().positive(),
  /** What runs, as a person would type it (`pnpm test:e2e`). */
  command: z.string(),
  /** The working copy the run started in. */
  workingCopy: z.string(),
  /** When the holder took the lock (ms since the epoch). */
  takenAt: z.number(),
});

export type LockRecord = z.infer<typeof lockRecordSchema>;

export function parseLockRecord(text: string): LockRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = lockRecordSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
