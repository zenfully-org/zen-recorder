const MEETING_CODE_RE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/;

/** Extracts the Google Meet meeting code (`abc-defg-hij`) from a pathname, or null. */
export function parseMeetingCode(pathname: string): string | null {
  return MEETING_CODE_RE.exec(pathname)?.[1] ?? null;
}
