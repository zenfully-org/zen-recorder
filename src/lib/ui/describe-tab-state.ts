/**
 * The popup's word for what a meeting tab is doing. A tab waiting in a meeting is "Ready" once
 * someone else is there (`countOthers`), else it waits for participants. A tab that records
 * nothing because of a fault that lasts (`describeTabAlert`) is "Not recording", as on its card.
 */
import type { TabSnapshot } from '@/lib/types';
import { countOthers } from '@/lib/ui/count-others';
import { describeTabAlert } from '@/lib/ui/describe-tab-alert';

export function describeTabState(snapshot: TabSnapshot): string {
  // A stop that waits for the extension to take what the page holds, or a recorder that gave up
  // on a broken encoder: nothing records, whatever the state says.
  if (describeTabAlert(snapshot)?.nothingRecords) return 'Not recording';
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
