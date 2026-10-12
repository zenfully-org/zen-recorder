import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { createVideoGate } from './create-video-gate';

describe('createVideoGate', () => {
  it('lets the video back once the extension took the recording that filled the backlog, and the running one keeps up', () => {
    let full: TabSnapshot['backlogFull'] = 'audio-only';
    const gate = createVideoGate(() => full);
    expect(gate.allows()).toBe(true);
    gate.fill();
    expect(gate.allows()).toBe(false);
    // The video recording that filled it still has chunks in the page.
    expect(gate.comesBack({ recording: true, pending: 0 })).toBe(false);
    full = undefined;
    // Paused, or the running recording waits for an ack: not yet.
    expect(gate.comesBack({ recording: false, pending: 0 })).toBe(false);
    expect(gate.comesBack({ recording: true, pending: 1 })).toBe(false);
    expect(gate.comesBack({ recording: true, pending: 0 })).toBe(true);
    expect(gate.allows()).toBe(true);
    // Once: the next recording records video, and asks nothing more.
    expect(gate.comesBack({ recording: true, pending: 0 })).toBe(false);
  });

  it('keeps the video off for the meeting once its pipeline failed, a full backlog or not, until another meeting', () => {
    const gate = createVideoGate(() => undefined);
    gate.fail('video-failed');
    gate.fill();
    expect(gate.comesBack({ recording: true, pending: 0 })).toBe(false);
    expect(gate.allows()).toBe(false);
    gate.reset();
    expect(gate.allows()).toBe(true);
  });

  it.each([
    ['nothing turned it off', [], null],
    ['the video pipeline could not start', ['pipeline-failed'], 'pipeline-failed'],
    ['the video failed while recording', ['video-failed'], 'video-failed'],
    ['a recording with video filled the backlog', ['fill'], 'backlog-full'],
    // A failure keeps the video off for the meeting, a full backlog only for a while: it wins.
    ['it failed, then filled the backlog', ['video-failed', 'fill'], 'video-failed'],
    ['it filled the backlog, then failed', ['fill', 'pipeline-failed'], 'pipeline-failed'],
  ] as const)('says why the video is off when %s', (_label, steps, why) => {
    const gate = createVideoGate(() => undefined);
    for (const step of steps) {
      if (step === 'fill') gate.fill();
      else gate.fail(step);
    }
    expect(gate.whyOff()).toBe(why);
  });

  it('says nothing once the video came back or another meeting started', () => {
    const gate = createVideoGate(() => undefined);
    gate.fill();
    gate.comesBack({ recording: true, pending: 0 });
    expect(gate.whyOff()).toBeNull();
    gate.fail('video-failed');
    gate.reset();
    expect(gate.whyOff()).toBeNull();
  });
});
