/**
 * How far the remux moves every timestamp back, in whole milliseconds, given the first packet's
 * time in seconds. Mediabunny's conversion starts the output at the first packet, or at 0 when it
 * is before 0, since such a packet means "do not show me" and is cut
 * (`Math.max(await input.getFirstTimestamp(tracks), 0)` in `node_modules/mediabunny/src/conversion.ts`,
 * 1.55.5). A position read on the recording's own clock lands in the saved file this much earlier.
 */
export function remuxStartOffsetMs(firstTimestampSeconds: number): number {
  return Math.round(Math.max(firstTimestampSeconds, 0) * 1000);
}
