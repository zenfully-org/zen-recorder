import { describe, expect, it } from 'vitest';
import type { MeetingPresence } from '@/lib/providers/types';
import { redactPresence } from './redact-presence';

const READING: MeetingPresence = {
  participants: [
    { key: 'name:Ana Souza', name: 'Ana Souza', self: false },
    { key: 'spaces/x/devices/2', name: null, self: null },
    { key: 'name:Ana Souza#2', name: 'Ana Souza', self: true },
  ],
  source: 'stage',
  count: 4,
  share: { kind: 'active', participantKey: 'name:Ana Souza#2', name: 'Ana Souza', self: true },
  selfMic: 'not-connected',
};

describe('redactPresence', () => {
  it('leaves the names out: each becomes its length, each key a number in page order', () => {
    expect(redactPresence(READING)).toEqual({
      participants: [
        { key: 'p1', name: 9, self: false },
        { key: 'p2', name: null, self: null },
        { key: 'p3', name: 9, self: true },
      ],
      source: 'stage',
      count: 4,
      share: { kind: 'active', participantKey: 'p3', name: 9, self: true },
      selfMic: 'not-connected',
    });
  });

  it('keeps a page where the provider cannot tell', () => {
    expect(redactPresence(null)).toBeNull();
  });

  it('numbers a sharer who is not on the stage after everyone who is', () => {
    const share = { kind: 'active', participantKey: 'name:Ben', name: 'Ben', self: false } as const;
    expect(redactPresence({ ...READING, share })?.share).toEqual({
      kind: 'active',
      participantKey: 'p4',
      name: 3,
      self: false,
    });
  });

  it.each<MeetingPresence['share']>([
    { kind: 'none' },
    { kind: 'unknown' },
    { kind: 'active', participantKey: null, name: null, self: false },
  ])('keeps a share that names nobody: %j', (share) => {
    expect(redactPresence({ ...READING, share })?.share).toEqual(share);
  });
});
