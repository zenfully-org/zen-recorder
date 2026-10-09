// @vitest-environment node
import { escapeCommandData } from './escape-command-data';

describe('escapeCommandData', () => {
  it('escapes a percent sign first, then the line breaks the runner would end the command at', () => {
    expect(escapeCommandData('100%\r\nnext')).toBe('100%25%0D%0Anext');
  });
});
