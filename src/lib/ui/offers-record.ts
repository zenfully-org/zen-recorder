/**
 * Whether the status card and the popup offer Record for a meeting tab: while nothing records, on
 * a page that names a meeting, even before its call connects. Where the page names none (a landing
 * page, the page a call left for, a call at an address the recorder does not know) the page
 * refuses Record: a recording there would stop at its next reading, before a sample.
 */
import type { TabSnapshot } from '@/lib/types';

export function offersRecord(snapshot: Pick<TabSnapshot, 'state' | 'meetingCode'>): boolean {
  return (
    (snapshot.state === 'idle' || snapshot.state === 'waiting') && snapshot.meetingCode !== null
  );
}
