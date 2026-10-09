import { describe, expect, it } from 'vitest';
import { parseRecordingRequest } from './parse-recording-request';

describe('parseRecordingRequest', () => {
  it('accepts a recording id', () => {
    expect(parseRecordingRequest({ id: 'rec-1' })).toEqual({ id: 'rec-1' });
  });

  it.each([undefined, null, 'rec-1', {}, { id: '' }, { id: 5 }, { id: null }])(
    'rejects %j',
    (input) => {
      expect(parseRecordingRequest(input)).toBeNull();
    },
  );
});
