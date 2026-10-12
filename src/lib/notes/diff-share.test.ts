import { describe, expect, it } from 'vitest';
import type { ParticipantRef } from '@/lib/types';
import { diffShare, type ShareReading, type ShareState } from './diff-share';

const ref = (id: string, name: string, self = false): ParticipantRef => ({
  id,
  name,
  self,
  identity: 'service-id',
});
const JO = ref('p1', 'Jo', true);
const ANA = ref('p2', 'Ana');
const BEN = ref('p3', 'Ben');

const NONE: ShareReading = { kind: 'none' };
const UNKNOWN: ShareReading = { kind: 'unknown' };
const by = (sharer: ParticipantRef | null): ShareReading => ({ kind: 'active', by: sharer });

/** Feeds the shares one second apart (null: no reading at all) and returns the events as rows. */
function run(shares: readonly (ShareReading | null)[], final = false): string[] {
  let state: ShareState | null = null;
  return shares.flatMap((share, index) => {
    const last = index === shares.length - 1;
    const result = diffShare(state, share, { atMs: index * 1000 }, final && last);
    state = result.state;
    return result.events.map(({ stamp, body }) => {
      const what = 'by' in body ? (body.by?.name ?? 'someone') : `${body.signal} ${body.reason}`;
      return `${stamp.atMs / 1000}s ${body.type} ${what}`;
    });
  });
}

describe('diffShare', () => {
  it.each<[string, (ShareReading | null)[], string[]]>([
    ['a share starts, by whom the page names', [NONE, by(ANA)], ['1s share-started Ana']],
    [
      'one sharer after another: a stop and a start',
      [by(ANA), by(BEN)],
      ['1s share-stopped Ana', '1s share-started Ben'],
    ],
    ['a share ends', [by(ANA), by(ANA), NONE], ['2s share-stopped Ana']],
    ['a share by nobody the page names', [NONE, by(null)], ['1s share-started someone']],
    [
      'a share by nobody named, then by someone named: another share',
      [by(null), by(ANA)],
      ['1s share-stopped someone', '1s share-started Ana'],
    ],
    ['a share running at the start: the start says it', [by(ANA), by(ANA)], []],
    ['a page that never shows shares writes none', [UNKNOWN, UNKNOWN, UNKNOWN], []],
    [
      'the share shown again after a while: the coverage, and no share event',
      [by(ANA), UNKNOWN, UNKNOWN, by(ANA)],
      [
        '1s coverage-lost share presence-unavailable',
        '3s coverage-restored share presence-unavailable',
      ],
    ],
    [
      'a share that ended while it was not shown: stamped when it is shown again',
      [by(ANA), UNKNOWN, NONE],
      [
        '1s coverage-lost share presence-unavailable',
        '2s coverage-restored share presence-unavailable',
        '2s share-stopped Ana',
      ],
    ],
    [
      'no reading of the call: shares are not observed either',
      [NONE, null, null, NONE],
      [
        '1s coverage-lost share presence-unavailable',
        '3s coverage-restored share presence-unavailable',
      ],
    ],
    ['no reading before shares were ever shown: nothing', [UNKNOWN, null, UNKNOWN], []],
    [
      'shares first shown later: known from there on',
      [UNKNOWN, by(ANA), NONE],
      ['2s share-stopped Ana'],
    ],
    // The recorder tells the user's own share itself, from the browser.
    ["the user's own share", [NONE, by(JO), by(JO), NONE], []],
    ["another's share after the user's", [by(JO), by(ANA)], ['1s share-started Ana']],
  ])('%s', (_label, shares, rows) => {
    expect(run(shares)).toEqual(rows);
  });

  it('writes no coverage lost when the recording ends without a reading', () => {
    expect(run([by(ANA), null], true)).toEqual([]);
  });
});
