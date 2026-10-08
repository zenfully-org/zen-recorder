// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readStepRecords } from './read-step-records';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zen-recorder-records-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const record = (step: string, startedAt: number) => ({
  step,
  command: `pnpm ${step}`,
  exitCode: 0,
  startedAt,
  endedAt: startedAt + 10,
});

describe('readStepRecords', () => {
  it('reads every record of the folder, in the order the steps started', () => {
    writeFileSync(path.join(dir, 'types.json'), JSON.stringify(record('types', 200)));
    writeFileSync(path.join(dir, 'lint.json'), JSON.stringify(record('lint', 100)));
    writeFileSync(path.join(dir, 'lint.log'), 'output');

    expect(readStepRecords(dir)).toEqual([record('lint', 100), record('types', 200)]);
  });

  it('reads no record from a folder that is not there: no `run` step ran', () => {
    expect(readStepRecords(path.join(dir, 'missing'))).toEqual([]);
  });

  it('refuses a record of another shape, naming its file', () => {
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'lint.json'), '{"step": "lint"}');

    expect(() => readStepRecords(dir)).toThrow(/lint\.json/);
  });
});
