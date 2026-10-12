/**
 * The Options page's words for each start rule, saying what the recorder waits for. The first
 * rule waits for people, not media: someone else is in the call once the page counts them
 * (Meet's people badge, Teams' roster, Zoom's counter less its waiting room), muted or not.
 * Remote audio stands in only where the page shows no count.
 */
import type { StartRule } from '@/lib/types';

export function describeStartRule(rule: StartRule): string {
  switch (rule) {
    case 'firstRemote':
      return 'once someone else is in the call';
    case 'onJoin':
      return 'as soon as the call is connected (even alone)';
  }
}
