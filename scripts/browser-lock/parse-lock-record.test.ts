import { describe, expect, it } from 'vitest';
import { type LockRecord, parseLockRecord } from './parse-lock-record';

const record: LockRecord = {
  token: 'b7f3',
  pid: 4242,
  command: 'pnpm test:e2e',
  workingCopy: '/work/zen-recorder',
  takenAt: 1_760_000_000_000,
};

describe('parseLockRecord', () => {
  it('reads the record a run wrote', () => {
    expect(parseLockRecord(JSON.stringify(record))).toEqual(record);
  });

  it.each<[string, string]>([
    ['an empty file, as flock leaves one', ''],
    ['text that is no JSON', 'locked'],
    ['JSON without a holder', '{}'],
    ['a record without its token', JSON.stringify({ ...record, token: '' })],
    ['a pid that is no process id', JSON.stringify({ ...record, pid: 0 })],
    ['JSON that is no object', '[4242]'],
  ])('finds no record in %s', (_, text) => {
    expect(parseLockRecord(text)).toBeNull();
  });
});
