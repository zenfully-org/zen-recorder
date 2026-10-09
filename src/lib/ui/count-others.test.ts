import { describe, expect, it } from 'vitest';
import { countOthers } from './count-others';

describe('countOthers', () => {
  it('takes the count of others the page sent', () => {
    expect(countOthers({ others: 0, remoteTracks: 1 })).toBe(0);
    expect(countOthers({ others: 3, remoteTracks: 1 })).toBe(3);
  });

  it('counts the remote audio tracks of a page session older than that count', () => {
    expect(countOthers({ remoteTracks: 2 })).toBe(2);
  });
});
