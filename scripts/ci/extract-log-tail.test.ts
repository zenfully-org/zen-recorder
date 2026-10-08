// @vitest-environment node
import { extractLogTail } from './extract-log-tail';

describe('extractLogTail', () => {
  it('keeps the last 20 lines that say something, without colours or GitHub commands', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    const log = [...lines.slice(0, 25), '', '   ', '::group::noise', ...lines.slice(25)].join('\n');

    expect(extractLogTail(`\u001b[31m${log}\u001b[39m\n`)).toEqual([
      {
        tool: 'log',
        message: lines.slice(10).join('\n'),
        file: null,
        line: null,
        column: null,
        rule: null,
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('finds nothing in an empty log', () => {
    expect(extractLogTail('\n \n')).toEqual([]);
  });
});
