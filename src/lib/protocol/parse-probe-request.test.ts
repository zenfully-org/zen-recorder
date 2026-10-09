import { describe, expect, it } from 'vitest';
import { parseProbeRequest } from './parse-probe-request';

describe('parseProbeRequest', () => {
  it('accepts a probe name', () => {
    expect(parseProbeRequest({ name: 'background:state' })).toEqual({ name: 'background:state' });
  });

  it.each([undefined, 'background:state', {}, { name: '' }, { name: 7 }])('rejects %j', (input) => {
    expect(parseProbeRequest(input)).toBeNull();
  });
});
