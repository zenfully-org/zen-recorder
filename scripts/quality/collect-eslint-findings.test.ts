// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { collectEslintFindings } from './collect-eslint-findings';

const root = '/work/repo';
const source = `export function createA() {\n  const handle = () => 1;\n  return handle;\n}\n`;

describe('collectEslintFindings', () => {
  it('turns each metric message into a finding on the function it belongs to', async () => {
    const results = [
      {
        filePath: `${root}/src/lib/a.ts`,
        source,
        messages: [
          {
            ruleId: 'sonarjs/cognitive-complexity',
            message:
              'Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed.',
            line: 1,
            column: 17,
            severity: 2,
          },
          {
            ruleId: 'max-params',
            message: 'Arrow function has too many parameters (5). Maximum allowed is 4.',
            line: 2,
            column: 18,
            severity: 2,
          },
          {
            ruleId: 'sonarjs/max-lines',
            message:
              'This file has 450 lines, which is greater than 400 authorized. Split it into smaller files.',
            line: 0,
            column: 1,
            severity: 2,
          },
        ],
      },
    ];
    const readSource = async (): Promise<string> => {
      throw new Error('the result already carries the source');
    };
    expect(await collectEslintFindings(results, { root, readSource })).toEqual([
      {
        file: 'src/lib/a.ts',
        line: 1,
        key: 'createA',
        metric: 'cognitive-complexity',
        value: 21,
        threshold: 15,
      },
      {
        file: 'src/lib/a.ts',
        line: 2,
        key: 'createA > handle',
        metric: 'max-params',
        value: 5,
        threshold: 4,
      },
      {
        file: 'src/lib/a.ts',
        line: 0,
        key: 'file',
        metric: 'max-lines',
        value: 450,
        threshold: 400,
      },
    ]);
  });

  it('reads the source from disk when the result does not carry it', async () => {
    const results = [
      {
        filePath: `${root}/src/lib/a.ts`,
        messages: [
          {
            ruleId: 'max-statements',
            message: 'Function has too many statements (41). Maximum allowed is 40.',
            line: 1,
            column: 8,
            severity: 2,
          },
        ],
      },
      { filePath: `${root}/src/lib/clean.ts`, messages: [] },
    ];
    const read: string[] = [];
    const readSource = async (file: string): Promise<string> => {
      read.push(file);
      return source;
    };
    expect(await collectEslintFindings(results, { root, readSource })).toEqual([
      {
        file: 'src/lib/a.ts',
        line: 1,
        key: 'createA',
        metric: 'max-statements',
        value: 41,
        threshold: 40,
      },
    ]);
    expect(read).toEqual([`${root}/src/lib/a.ts`]);
  });

  it('makes a message of any other rule, such as a SonarJS code smell, a yes-or-no finding named after the rule', async () => {
    const nested = 'Extract this nested ternary operation into an independent statement.';
    const messages = [
      { ruleId: 'sonarjs/no-nested-conditional', message: nested, line: 2, column: 10 },
      { ruleId: 'no-console', message: 'Unexpected console statement.', line: 2, column: 1 },
    ];
    const results = [{ filePath: `${root}/src/lib/a.ts`, source, messages }];
    const readSource = async (): Promise<string> => source;
    const common = { file: 'src/lib/a.ts', line: 2, key: 'createA', value: 1, threshold: null };
    expect(await collectEslintFindings(results, { root, readSource })).toEqual([
      { ...common, metric: 'no-nested-conditional' },
      { ...common, metric: 'no-console' },
    ]);
  });

  it('fails on a file ESLint could not parse, so a broken file cannot pass as clean', async () => {
    const results = [
      {
        filePath: `${root}/src/lib/broken.ts`,
        source: 'export const =',
        messages: [
          {
            ruleId: null,
            fatal: true,
            message: 'Parsing error: Unexpected token',
            line: 1,
            column: 14,
            severity: 2,
          },
        ],
      },
    ];
    await expect(
      collectEslintFindings(results, { root, readSource: async () => '' }),
    ).rejects.toThrow(/src\/lib\/broken\.ts:1:14 Parsing error/);
  });

  it('uses forward slashes in the file name on every platform', async () => {
    const results = [
      {
        filePath: 'C:\\work\\repo\\src\\lib\\a.ts',
        source,
        messages: [
          {
            ruleId: 'max-params',
            message: 'Arrow function has too many parameters (5). Maximum allowed is 4.',
            line: 2,
            column: 18,
            severity: 2,
          },
        ],
      },
    ];
    const findings = await collectEslintFindings(results, {
      root: 'C:\\work\\repo',
      readSource: async () => source,
    });
    expect(findings[0]?.file).toBe('src/lib/a.ts');
  });
});

describe('collectEslintFindings and inline ESLint comments', () => {
  it('makes an inline eslint comment, which the configuration ignores, a finding of its own so it gets removed', async () => {
    const ignored =
      "'// eslint-disable-next-line sonarjs/no-nested-conditional' has no effect because you have 'noInlineConfig' setting in your config.";
    const messages = [
      { ruleId: null, message: ignored, line: 2, column: 3 },
      {
        ruleId: null,
        message: 'File ignored because of a matching ignore pattern.',
        line: 0,
        column: 0,
      },
    ];
    const results = [{ filePath: `${root}/src/lib/a.ts`, source, messages }];
    expect(await collectEslintFindings(results, { root, readSource: async () => source })).toEqual([
      {
        file: 'src/lib/a.ts',
        line: 2,
        key: 'createA',
        metric: 'no-inline-config',
        value: 1,
        threshold: null,
      },
    ]);
  });
});
