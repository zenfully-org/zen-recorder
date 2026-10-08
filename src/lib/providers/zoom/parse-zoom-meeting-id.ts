const MEETING_ID_RE = /^\/wc\/(\d{9,11})(?:\/|$)/;

/**
 * Extracts the meeting number from a Zoom web-client pathname (`/wc/<number>/join`, or
 * `/wc/<number>/start` for the host), or null. `/wc` and `/wc/home` are the client's shell.
 */
export function parseZoomMeetingId(pathname: string): string | null {
  return MEETING_ID_RE.exec(pathname)?.[1] ?? null;
}
