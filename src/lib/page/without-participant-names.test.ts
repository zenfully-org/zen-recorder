import { describe, expect, it } from 'vitest';
import type { MeetingEventBody, ParticipantRef } from '@/lib/types';
import { withoutParticipantNames } from './without-participant-names';

const ana: ParticipantRef = { id: 'p2', name: 'Ana', self: false, identity: 'service-id' };
const anonymous: ParticipantRef = { ...ana, name: null };

describe('withoutParticipantNames', () => {
  it.each<[string, MeetingEventBody, MeetingEventBody]>([
    [
      'a reading of the call',
      {
        type: 'roster',
        why: 'start',
        source: 'stage',
        participants: [ana],
        count: 2,
        share: 'active',
        shareBy: ana,
        stale: false,
        readAtMs: 0,
        capabilities: null,
      },
      {
        type: 'roster',
        why: 'start',
        source: 'stage',
        participants: [anonymous],
        count: 2,
        share: 'active',
        shareBy: anonymous,
        stale: false,
        readAtMs: 0,
        capabilities: null,
      },
    ],
    [
      'a reading that names no sharer',
      {
        type: 'roster',
        why: 'stop',
        source: null,
        participants: [],
        count: null,
        share: 'unknown',
        shareBy: null,
        stale: false,
        readAtMs: 0,
        capabilities: null,
      },
      {
        type: 'roster',
        why: 'stop',
        source: null,
        participants: [],
        count: null,
        share: 'unknown',
        shareBy: null,
        stale: false,
        readAtMs: 0,
        capabilities: null,
      },
    ],
    [
      'a join',
      { type: 'participant-joined', participant: ana, count: 3 },
      { type: 'participant-joined', participant: anonymous, count: 3 },
    ],
    [
      'a leave of nobody named',
      { type: 'participant-left', participant: null, count: 2 },
      { type: 'participant-left', participant: null, count: 2 },
    ],
    [
      'a rename',
      { type: 'participant-renamed', participant: ana, from: 'Ana S.' },
      { type: 'participant-renamed', participant: anonymous, from: null },
    ],
    [
      'an event about no one',
      { type: 'participant-count', count: 4 },
      { type: 'participant-count', count: 4 },
    ],
  ])('%s keeps everything but the names', (_label, body, expected) => {
    expect(withoutParticipantNames(body)).toEqual(expected);
  });
});
