/**
 * The popup's word for what a meeting tab is doing. A tab waiting in a meeting is "Ready" once
 * someone else is there (`countOthers`), else it waits for participants.
 */
import type { TabSnapshot } from '@/lib/types';
import { countOthers } from '@/lib/ui/count-others';

export function describeTabState(snapshot: TabSnapshot): string {
  switch (snapshot.state) {
    case 'recording':
      return 'Recording';
    case 'paused':
      return 'Paused';
    case 'stopping':
      return 'Saving…';
    case 'waiting':
      return countOthers(snapshot) > 0 ? 'Ready' : 'Waiting for participants';
    case 'idle':
      return snapshot.meetingCode ? 'Not connected' : 'No meeting';
  }
}
