import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { offersRecord } from './offers-record';

describe('offersRecord', () => {
  it.each<[string, Pick<TabSnapshot, 'state' | 'unknownAddress'>, boolean]>([
    ['idle', { state: 'idle' }, true],
    ['waiting', { state: 'waiting' }, true],
    ['recording', { state: 'recording' }, false],
    ['paused', { state: 'paused' }, false],
    ['stopping', { state: 'stopping' }, false],
    // A recording there would end at once: the page names no meeting to record.
    ['in a call at an address it does not know', { state: 'idle', unknownAddress: true }, false],
  ])('%s: %j', (_label, snapshot, offered) => {
    expect(offersRecord(snapshot)).toBe(offered);
  });
});
