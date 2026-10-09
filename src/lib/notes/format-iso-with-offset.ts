/** Formats like `2026-10-04 14:03:05`: the ISO order, in every engine's Swedish locale. */
const LOCAL_TIME = (timeZone: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * An instant as ISO 8601 in `timeZone`, to the second, with the offset that zone had at that
 * instant (`2026-10-04T14:03:05+02:00`): a change of daylight saving time during a meeting is
 * right. Built by hand, since `toISOString()` gives UTC only. Milliseconds are floored.
 */
export function formatIsoWithOffset(epochMs: number, timeZone: string): string {
  const instant = Math.floor(epochMs / 1000) * 1000;
  const local = LOCAL_TIME(timeZone).format(instant).replace(' ', 'T');
  // The wall time read as if it were UTC, against the instant: the zone's offset then.
  const offset = Math.round((Date.parse(`${local}Z`) - instant) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const minutes = Math.abs(offset);
  return `${local}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
