/**
 * When canvas snapshots froze a meeting page during a recording, read from the Diagnostics log (the
 * `diagnostics` probe's answer). The recorder logs "a canvas snapshot blocked the page for N ms"
 * once such a snapshot returns, and the line is stamped as the page hands it on, right after: the
 * freeze ended at the stamp and began N ms before. The log is the browser's, so it also holds the
 * freezes of earlier recordings; only those that ended once the file began (`startedAt`, epoch ms)
 * are returned, in ms into the file.
 */
import { z } from 'zod';
import type { CanvasFreeze } from './judge-seen-at';

const entriesSchema = z.array(z.object({ at: z.number(), message: z.string() }));
const BLOCKED = /a canvas snapshot blocked the page for (\d+) ms/;

export function readCanvasFreezes(diagnostics: unknown, startedAt: number): CanvasFreeze[] {
  return entriesSchema.parse(diagnostics).flatMap(({ at, message }) => {
    const ms = BLOCKED.exec(message)?.[1];
    const to = at - startedAt;
    return ms === undefined || to < 0 ? [] : [{ from: to - Number(ms), to }];
  });
}
