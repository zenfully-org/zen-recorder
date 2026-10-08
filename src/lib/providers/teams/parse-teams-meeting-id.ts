import { z } from 'zod';
import type { MeetingLocation } from '@/lib/providers/types';

/** `…/meetup-join/19:meeting_<id>@thread.v2/0` in a (decoded) path, query or hash route. */
const JOIN_LINK_RE = /\/meetup-join\/19:([^@/]+)@/;
const THREAD_RE = /^19:([^@]+)@/;
/** Short meeting links: `teams.live.com/meet/<number>`, `teams.microsoft.com/meet/<number>`. */
const SHORT_LINK_RE = /^\/(?:v2\/)?meet\/([A-Za-z0-9]+)(?:\/|$)/;

const coordsSchema = z.object({ conversationId: z.string() });

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The light meeting page carries the meeting in `coords`: base64 JSON with the thread id. */
function threadFromCoords(search: string): string | null {
  const coords = new URLSearchParams(search).get('coords');
  if (!coords) return null;
  try {
    // URL-safe alphabet, and "+" turned into a space by the query-string decoding.
    const base64 = coords.replaceAll('-', '+').replaceAll('_', '/').replaceAll(' ', '+');
    const parsed = coordsSchema.safeParse(JSON.parse(atob(base64)));
    return parsed.success ? (THREAD_RE.exec(parsed.data.conversationId)?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The meeting a Teams URL points at, or null. Only the join routes carry one: the join link and
 * the hops it redirects through, the light meeting page (anonymous guests) and the short links.
 * A signed-in call has nothing in the URL (the provider then identifies the call by its UI).
 */
export function parseTeamsMeetingId(location: MeetingLocation): string | null {
  const route = [location.pathname, location.search, location.hash].map(decode).join(' ');
  return (
    threadFromCoords(location.search) ??
    JOIN_LINK_RE.exec(route)?.[1] ??
    SHORT_LINK_RE.exec(location.pathname)?.[1] ??
    null
  );
}
