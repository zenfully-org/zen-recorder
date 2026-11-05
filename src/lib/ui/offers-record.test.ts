import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { offersRecord } from './offers-record';

type Offered = Pick<TabSnapshot, 'state' | 'meetingCode' | 'unknownAddress'>;

describe('offersRecord', () => {
  it.each<[string, Offered, boolean]>([
    // Record works on any meeting route, even alone before the call connects.
    ['idle on a meeting route', { state: 'idle', meetingCode: 'abc-defg-hij' }, true],
    ['waiting in a meeting', { state: 'waiting', meetingCode: 'abc-defg-hij' }, true],
    ['recording', { state: 'recording', meetingCode: 'abc-defg-hij' }, false],
    ['paused', { state: 'paused', meetingCode: 'abc-defg-hij' }, false],
    ['stopping', { state: 'stopping', meetingCode: 'abc-defg-hij' }, false],
    // A recording there would stop at the page's next reading, before a sample: the page refuses it.
    ['on a page that shows no meeting', { state: 'idle', meetingCode: null }, false],
    [
      'in a call at an address it does not know',
      { state: 'idle', meetingCode: null, unknownAddress: true },
      false,
    ],
  ])('%s: %j', (_label, snapshot, offered) => {
    expect(offersRecord(snapshot)).toBe(offered);
  });
});
