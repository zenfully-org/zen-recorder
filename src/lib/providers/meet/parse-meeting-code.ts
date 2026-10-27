/**
 * The code at the start of the path (`/abc-defg-hij`), or under `/meet/`, where Meet opens some
 * meetings since 2026-10 (`/meet/abc-defg-hij`). Any other prefix (`/_meet/`) is not a meeting.
 */
const MEETING_CODE_RE = /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/;

/** Extracts the Google Meet meeting code (`abc-defg-hij`) from a pathname, or null. */
export function parseMeetingCode(pathname: string): string | null {
  return MEETING_CODE_RE.exec(pathname)?.[1] ?? null;
}
