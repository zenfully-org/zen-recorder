/**
 * Whether the status card and the popup offer Record for a meeting tab: while nothing records, as
 * long as a recording can start there. In a call whose address names no meeting the recorder
 * knows, one would end at once, since the page names no meeting to record.
 */
import type { TabSnapshot } from '@/lib/types';

export function offersRecord(snapshot: Pick<TabSnapshot, 'state' | 'unknownAddress'>): boolean {
  return (snapshot.state === 'idle' || snapshot.state === 'waiting') && !snapshot.unknownAddress;
}
