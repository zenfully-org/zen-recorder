// @vitest-environment node
import { makeFailure } from './make-failure';

describe('makeFailure', () => {
  it('sets every field the tool did not say to null', () => {
    expect(makeFailure({ tool: 'tsc', message: 'Type mismatch.', line: 3 })).toEqual({
      tool: 'tsc',
      message: 'Type mismatch.',
      file: null,
      line: 3,
      column: null,
      rule: null,
      test: null,
      scenario: null,
      provider: null,
    });
  });
});
