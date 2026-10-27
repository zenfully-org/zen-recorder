/**
 * Says in Diagnostics when the page is in a call whose address names no meeting the provider
 * knows: it reads the user admitted but no meeting id, so nothing records, automatically or on
 * Record. A service that moves its meetings to a new address breaks the recorder that way, without
 * an error; this line is how the first call it breaks shows it. Once per address, since the page
 * is read every second: a move to another address says it again. The line gives the host and the
 * path's shape (`maskPath`), never the path.
 */
import { maskPath } from '@/lib/page/mask-path';
import type { MeetingLocation, MeetingState } from '@/lib/providers/types';

export interface AddressReportDeps {
  readLocation: () => Pick<MeetingLocation, 'hostname' | 'pathname'>;
  log: (level: 'warn', message: string) => void;
}

export function createAddressReport(
  deps: AddressReportDeps,
): (meeting: Pick<MeetingState, 'meetingId' | 'admitted'>) => void {
  const reported = new Set<string>();
  return (meeting) => {
    if (!meeting.admitted || meeting.meetingId !== null) return;
    const { hostname, pathname } = deps.readLocation();
    if (reported.has(pathname)) return;
    reported.add(pathname);
    const where = `host ${hostname}, path ${maskPath(pathname)} with letters as a and digits as 0`;
    deps.log(
      'warn',
      `in a call, but the address names no meeting this version knows (${where}): nothing records`,
    );
  };
}
