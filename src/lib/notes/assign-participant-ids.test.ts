import { describe, expect, it } from 'vitest';
import type { Participant } from '@/lib/providers/types';
import { assignParticipantIds, type ParticipantIds } from './assign-participant-ids';

const person = (key: string, name: string | null, self: boolean | null = false): Participant => ({
  key,
  name,
  self,
});

/** Assigns ids to readings one after another in one meeting; the ids each reading got. */
function readAll(readings: readonly (readonly Participant[])[], meetingId = 'abc-defg-hij') {
  let ids: ParticipantIds | null = null;
  return readings.map((reading) => {
    const assigned = assignParticipantIds(ids, meetingId, reading);
    ids = assigned.ids;
    return assigned;
  });
}

describe('assignParticipantIds', () => {
  it('gives the user the first id, before anyone the page shows', () => {
    const [first] = readAll([[person('d2', 'Ana'), person('d1', 'Jo', true)]]);
    expect(first?.self).toEqual({ id: 'p1', name: 'Jo', self: true, identity: 'service-id' });
    expect(first?.participants).toEqual([
      { id: 'p2', name: 'Ana', self: false, identity: 'service-id' },
      { id: 'p1', name: 'Jo', self: true, identity: 'service-id' },
    ]);
  });

  it('keeps the user without a name where the page does not mark them', () => {
    // Zoom's stage: the user's own tile is a person the page cannot place.
    const [first] = readAll([[person('name:Jo', 'Jo', null), person('name:Ana', 'Ana', null)]]);
    expect(first?.self).toEqual({ id: 'p1', name: null, self: true, identity: 'service-id' });
    expect(first?.participants.map((ref) => [ref.id, ref.self])).toEqual([
      ['p2', null],
      ['p3', null],
    ]);
  });

  it('numbers people in the order they are first seen, whatever order a later reading has', () => {
    const readings = readAll([
      [person('d2', 'Ana'), person('d3', 'Ben')],
      [person('d4', 'Chloé'), person('d3', 'Ben'), person('d2', 'Ana')],
    ]);
    expect(readings[1]?.participants.map((ref) => ref.id)).toEqual(['p4', 'p3', 'p2']);
  });

  it('keeps the id across a rename when the key survives it, with the new name', () => {
    const readings = readAll([[person('d2', 'Ana')], [person('d2', 'Ana Souza')]]);
    expect(readings[1]?.participants).toEqual([
      { id: 'p2', name: 'Ana Souza', self: false, identity: 'service-id' },
    ]);
  });

  it('gives a new key the id of someone of that name who is gone: a rejoin, by name', () => {
    const readings = readAll([[person('d2', 'Ben')], [], [person('d9', 'Ben')]]);
    expect(readings[2]?.participants).toEqual([
      { id: 'p2', name: 'Ben', self: false, identity: 'display-name' },
    ]);
  });

  it('keys made of names are a guess too', () => {
    const [first] = readAll([[person('name:Ana', 'Ana')]]);
    expect(first?.participants[0]?.identity).toBe('display-name');
  });

  it('gives two people present at once with one name two ids', () => {
    const readings = readAll([
      [person('d2', 'Ben')],
      // The known Ben is still there: the second one is somebody else.
      [person('d9', 'Ben'), person('d2', 'Ben')],
    ]);
    expect(readings[1]?.participants.map((ref) => [ref.id, ref.identity])).toEqual([
      ['p3', 'service-id'],
      ['p2', 'service-id'],
    ]);
  });

  it('merges by name only once per reading', () => {
    const readings = readAll([[person('d2', 'Ben')], [person('d8', 'Ben'), person('d9', 'Ben')]]);
    expect(readings[1]?.participants.map((ref) => ref.id)).toEqual(['p2', 'p3']);
  });

  it('never merges someone else into the user by name', () => {
    const readings = readAll([[person('d1', 'Jo', true)], [person('d5', 'Jo')]]);
    expect(readings[1]?.participants.map((ref) => ref.id)).toEqual(['p2']);
  });

  it('merges no one without a name', () => {
    const readings = readAll([[person('d2', null)], [person('d3', null)]]);
    expect(readings[1]?.participants.map((ref) => ref.id)).toEqual(['p3']);
  });

  it('lists a person the page shows twice once', () => {
    const [first] = readAll([[person('d2', 'Ana'), person('d2', 'Ana'), person('d1', 'Jo', true)]]);
    expect(first?.participants.map((ref) => ref.id)).toEqual(['p2', 'p1']);
  });

  it('remembers the user’s name when a later reading does not mark them', () => {
    const readings = readAll([[person('d1', 'Jo', true)], [person('d2', 'Ana')]]);
    expect(readings[1]?.self.name).toBe('Jo');
  });

  it('starts again from p1 in another meeting', () => {
    const first = assignParticipantIds(null, 'abc-defg-hij', [person('d2', 'Ana')]);
    const same = assignParticipantIds(first.ids, 'abc-defg-hij', [person('d2', 'Ana')]);
    const other = assignParticipantIds(same.ids, 'xyz-wxyz-xyz', [person('d7', 'Kai')]);
    expect(same.participants[0]?.id).toBe('p2');
    expect(other.participants[0]?.id).toBe('p2');
    expect(other.ids.meetingId).toBe('xyz-wxyz-xyz');
    // The other meeting's people are not this one's.
    const back = assignParticipantIds(other.ids, 'xyz-wxyz-xyz', [person('d2', 'Ana')]);
    expect(back.participants[0]?.id).toBe('p3');
  });

  it('leaves the ids it was given as they were', () => {
    const first = assignParticipantIds(null, 'm', [person('d2', 'Ana')]);
    const before = JSON.stringify([...first.ids.byKey]);
    assignParticipantIds(first.ids, 'm', [person('d3', 'Ben')]);
    expect(JSON.stringify([...first.ids.byKey])).toBe(before);
  });
});
