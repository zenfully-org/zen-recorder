import { describe, expect, it } from 'vitest';
import type { AudioOnlyReason, StartTrigger, StopReason } from '@/lib/types';
import { createStartFacts, type StartFacts } from './create-start-facts';

const FIRST = 'first';
const NEXT = 'next';
const MEETING = 'abc-defg-hij';
const STOPPED_AT = 1_700_000_030_000;

/** What the first recording was and how it stopped, and how the next one starts 140 ms later. */
interface Row {
  label: string;
  first: { video: boolean; reason: StopReason; meetingId: string | null } | null;
  next: { trigger: StartTrigger; meetingId?: string | null; audioOnlyReason?: AudioOnlyReason };
  expected: StartFacts;
}

const first = (video: boolean, reason: StopReason, meetingId: string | null = MEETING) => ({
  video,
  reason,
  meetingId,
});
const NOTHING = { continuesRecordingId: null, gapMs: null } as const;
const CONTINUES = { continuesRecordingId: FIRST, gapMs: 140 } as const;

const rows: Row[] = [
  {
    label: 'the first recording of the page, by itself',
    first: null,
    next: { trigger: 'firstRemote' },
    expected: { cause: 'auto-first-remote', audioOnlyReason: null, ...NOTHING },
  },
  {
    label: 'by itself once the call connected, video off',
    first: null,
    next: { trigger: 'onJoin', audioOnlyReason: 'setting-off' },
    expected: { cause: 'auto-on-join', audioOnlyReason: 'setting-off', ...NOTHING },
  },
  {
    label: 'the restart after the video failed',
    first: first(true, 'encoder-error'),
    next: { trigger: 'encoder-error', audioOnlyReason: 'video-failed' },
    expected: {
      cause: 'restart-after-video-failure',
      audioOnlyReason: 'video-failed',
      ...CONTINUES,
    },
  },
  {
    label: 'the restart after the audio encoder failed',
    first: first(false, 'encoder-error'),
    next: { trigger: 'encoder-error', audioOnlyReason: 'no-encoder' },
    expected: { cause: 'restart-after-encoder-error', audioOnlyReason: 'no-encoder', ...CONTINUES },
  },
  {
    label: 'the restart after video filled the backlog',
    first: first(true, 'backlog-full'),
    next: { trigger: 'backlog-full', audioOnlyReason: 'backlog-full' },
    expected: {
      cause: 'restart-after-backlog-full',
      audioOnlyReason: 'backlog-full',
      ...CONTINUES,
    },
  },
  {
    label: 'the restart once the extension took that backlog',
    first: first(false, 'video-back'),
    next: { trigger: 'video-back' },
    expected: { cause: 'restart-after-video-back', audioOnlyReason: null, ...CONTINUES },
  },
  {
    label: 'Record after Stop',
    first: first(true, 'command'),
    next: { trigger: 'command' },
    expected: { cause: 'manual', audioOnlyReason: null, ...CONTINUES },
  },
  {
    label: 'by itself once the call came back after it was lost',
    first: first(true, 'connections-lost'),
    next: { trigger: 'firstRemote' },
    expected: { cause: 'auto-first-remote', audioOnlyReason: null, ...CONTINUES },
  },
  {
    label: 'in another meeting',
    first: first(true, 'left-meeting', 'xyz-abcd-efg'),
    next: { trigger: 'firstRemote' },
    expected: { cause: 'auto-first-remote', audioOnlyReason: null, ...NOTHING },
  },
  {
    label: 'by hand outside any meeting, after another one there',
    first: first(false, 'command', null),
    next: { trigger: 'command', meetingId: null },
    expected: { cause: 'manual', audioOnlyReason: null, ...NOTHING },
  },
];

describe('createStartFacts', () => {
  it.each(rows)('$label', ({ first, next, expected }) => {
    const facts = createStartFacts();
    if (first) {
      const start = {
        trigger: 'firstRemote',
        meetingId: first.meetingId,
        audioOnlyReason: null,
      } as const;
      facts.started({ id: FIRST, video: first.video ? {} : null }, start, STOPPED_AT - 30_000);
      facts.stopped(FIRST, STOPPED_AT);
    }
    const start = {
      trigger: next.trigger,
      meetingId: next.meetingId === undefined ? MEETING : next.meetingId,
      audioOnlyReason: next.audioOnlyReason ?? null,
    };
    expect(facts.started({ id: NEXT, video: null }, start, STOPPED_AT + 140)).toEqual(expected);
  });

  const AUTO = { trigger: 'firstRemote', meetingId: MEETING, audioOnlyReason: null } as const;

  // A page that goes away hands its recording over twice when Firefox cut the first short.
  it('keeps the first stop of a recording, and none of a recording that does not run', () => {
    const facts = createStartFacts();
    facts.started({ id: FIRST, video: null }, AUTO, 0);
    facts.stopped(FIRST, 1_000);
    facts.stopped(FIRST, 5_000);
    facts.stopped('another', 6_000);
    expect(facts.started({ id: NEXT, video: null }, AUTO, 9_000).gapMs).toBe(8_000);
  });

  it('gives no negative gap when the clock went back between the two', () => {
    const facts = createStartFacts();
    facts.started({ id: FIRST, video: null }, AUTO, 60_000);
    facts.stopped(FIRST, 70_000);
    expect(facts.started({ id: NEXT, video: null }, AUTO, 10_000).gapMs).toBe(0);
  });
});
