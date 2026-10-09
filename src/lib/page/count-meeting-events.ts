/** The counts a recording's end carries about its meeting events. */
export interface MeetingEventCounts {
  /** Events the bridge acked: seq 0 up to the last acked one. */
  eventCount: number;
  /** Of those, the seqs the page dropped when its queue was full. */
  eventsDropped: number;
  /** Events numbered after the last ack, which the bridge has not acked yet. */
  eventsUnsent: number;
}

/**
 * Counts a recording's events from where its sender stands: the highest seq the bridge acked, the
 * seqs the queue dropped, and the next seq to number. A drop past the last ack is among the unsent.
 */
export function countMeetingEvents(state: {
  lastAckedSeq: number;
  dropped: readonly number[];
  nextSeq: number;
}): MeetingEventCounts {
  const eventCount = state.lastAckedSeq + 1;
  return {
    eventCount,
    eventsDropped: state.dropped.filter((seq) => seq < eventCount).length,
    eventsUnsent: state.nextSeq - eventCount,
  };
}
