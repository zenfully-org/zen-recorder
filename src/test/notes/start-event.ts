/**
 * A recording's start event as a page of this version sends it, for the tests that need one and
 * care only about its stamp: nothing is known about the start unless `facts` says it.
 */
import type { MeetingEvent } from '@/lib/types';

type StartEvent = Extract<MeetingEvent, { type: 'recording-started' }>;
type Stamp = Pick<StartEvent, 'seq' | 'atMs' | 'mediaMs'>;

export const startEvent = (stamp: Stamp, facts: Partial<StartEvent> = {}): StartEvent => ({
  ...stamp,
  type: 'recording-started',
  cause: null,
  media: null,
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
  mic: null,
  tabVisible: null,
  ownShare: null,
  ...facts,
});
