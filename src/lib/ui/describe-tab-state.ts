/**
 * The popup's word for what a meeting tab is doing. A tab waiting in a meeting is "Ready" once
 * someone else is there (`countOthers`), else it waits for participants. A tab whose page holds
 * as much as it may and records nothing is "Not recording", as on its status card.
 */
import type { TabSnapshot } from '@/lib/types';
import { countOthers } from '@/lib/ui/count-others';

export function describeTabState(snapshot: TabSnapshot): string {
  // A stop that waits for the extension to take what the page holds saves nothing yet, and no
  // recording follows it until then.
  if (snapshot.backlogFull === 'waiting') return 'Not recording';
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
