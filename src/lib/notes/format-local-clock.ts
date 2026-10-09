/**
 * The local time of an ISO instant (`14:03:05`), with its UTC offset when it differs from the
 * recording's start (`02:05:00 (UTC+01:00)`): across a change of daylight saving time, a bare
 * clock would read as going back.
 */
export function formatLocalClock(iso: string, startIso: string): string {
  const offset = iso.slice(19);
  return offset === startIso.slice(19) ? iso.slice(11, 19) : `${iso.slice(11, 19)} (UTC${offset})`;
}
