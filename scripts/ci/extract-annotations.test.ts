// @vitest-environment node
import { extractAnnotations } from './extract-annotations';

const ROOT = '/work/repo';

describe('extractAnnotations', () => {
  it("reads a failing test from Vitest's github-actions reporter, relative to the repository", () => {
    const log = [
      ' Test Files  1 failed (1)',
      `::error file=${ROOT}/src/lib/cn.test.ts,title=src/lib/cn.test.ts > cn > merges classes,line=5,column=29::AssertionError: expected 2 to be 3 // Object.is equality%0A%0A- Expected%0A+ Received%0A%0A- 3%0A+ 2%0A%0A ❯ src/lib/cn.test.ts:5:29%0A%0A`,
    ].join('\n');

    expect(extractAnnotations(log, ROOT)).toEqual([
      {
        tool: 'vitest',
        message:
          'AssertionError: expected 2 to be 3 // Object.is equality\n\n- Expected\n+ Received\n\n- 3\n+ 2',
        file: 'src/lib/cn.test.ts',
        line: 5,
        column: 29,
        rule: null,
        test: 'cn > merges classes',
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('reads any other error a step wrote as a workflow command, with or without a place', () => {
    const log = [
      '::warning file=a.ts,line=1::only a warning',
      '::error::the build has no LICENSE',
      '::error title=lint/suspicious/noDoubleEquals,file=src/a.ts,line=4,endLine=4,col=13,endColumn=15::Using == may be unsafe%2C really',
    ].join('\n');

    expect(extractAnnotations(log, ROOT)).toEqual([
      {
        tool: 'annotation',
        message: 'the build has no LICENSE',
        file: null,
        line: null,
        column: null,
        rule: null,
        test: null,
        scenario: null,
        provider: null,
      },
      {
        tool: 'annotation',
        message: 'Using == may be unsafe, really',
        file: 'src/a.ts',
        line: 4,
        column: 13,
        rule: 'lint/suspicious/noDoubleEquals',
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('decodes escaped properties and keeps a long message to its first lines', () => {
    const message = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('%0A');
    const log = `::error file=src/a%2Cb.ts,line=2,title=x%3A y::${message}`;

    const [failure] = extractAnnotations(log, ROOT);

    expect(failure?.file).toBe('src/a,b.ts');
    expect(failure?.rule).toBe('x: y');
    expect(failure?.message.split('\n')).toHaveLength(12);
  });

  it('finds nothing in a log without error commands', () => {
    expect(extractAnnotations('all good\n::notice::fine', ROOT)).toEqual([]);
  });
});
