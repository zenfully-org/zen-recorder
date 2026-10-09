import { describe, expect, it } from 'vitest';
import { countMeetingEvents } from './count-meeting-events';

describe('countMeetingEvents', () => {
  it.each([
    ['nothing numbered', { lastAckedSeq: -1, dropped: [], nextSeq: 0 }, [0, 0, 0]],
    ['every event acked', { lastAckedSeq: 4, dropped: [], nextSeq: 5 }, [5, 0, 0]],
    ['the last two not acked', { lastAckedSeq: 2, dropped: [], nextSeq: 5 }, [3, 0, 2]],
    // Only the drops the bridge got past count: the rest are among the unsent.
    [
      'drops below and above the last ack',
      { lastAckedSeq: 5, dropped: [2, 3, 8], nextSeq: 10 },
      [6, 2, 4],
    ],
  ])('%s', (_label, state, [eventCount, eventsDropped, eventsUnsent]) => {
    expect(countMeetingEvents(state)).toEqual({ eventCount, eventsDropped, eventsUnsent });
  });
});
