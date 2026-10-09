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
    gate.fail();
    gate.fill();
    expect(gate.comesBack({ recording: true, pending: 0 })).toBe(false);
    expect(gate.allows()).toBe(false);
    gate.reset();
    expect(gate.allows()).toBe(true);
  });
});
