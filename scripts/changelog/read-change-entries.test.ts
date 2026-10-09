// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readChangeEntries } from './read-change-entries';

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'zen-recorder-changes-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

describe('readChangeEntries', () => {
  it('reads every entry with its group, the groups in release order, each by its file name', () => {
    write('changes/fixed/10.md', 'Fix ten. (#10)\n');
    write('changes/added/options-page.md', 'The Options page.\n');
    write('changes/fixed/7.md', 'Fix seven. (#7)\n');
    write('changes/added/3.md', 'Feature three. (#3)\n');
    write('changes/fixed/before-the-tracker.md', 'An old fix.\n');
    write('changes/changed/new-id.md', 'A new id.\n');

    expect(readChangeEntries(root)).toEqual([
      { group: 'Added', file: 'changes/added/3.md', text: 'Feature three. (#3)' },
      { group: 'Added', file: 'changes/added/options-page.md', text: 'The Options page.' },
      { group: 'Changed', file: 'changes/changed/new-id.md', text: 'A new id.' },
      { group: 'Fixed', file: 'changes/fixed/7.md', text: 'Fix seven. (#7)' },
      { group: 'Fixed', file: 'changes/fixed/10.md', text: 'Fix ten. (#10)' },
      { group: 'Fixed', file: 'changes/fixed/before-the-tracker.md', text: 'An old fix.' },
    ]);
  });

  it('keeps the blank lines inside an entry, and drops those around it and the spaces at line ends', () => {
    write('changes/changed/steps.md', '\n\nMove once:  \n1. First.\n\nThen go on.\n\n\n');

    expect(readChangeEntries(root)).toEqual([
      {
        group: 'Changed',
        file: 'changes/changed/steps.md',
        text: 'Move once:\n1. First.\n\nThen go on.',
      },
    ]);
  });

  it('reads no entry when there is no changes folder, and leaves out its README', () => {
    expect(readChangeEntries(root)).toEqual([]);
    write('changes/README.md', 'How to write an entry.\n');
    expect(readChangeEntries(root)).toEqual([]);
  });

  it.each([
    ['a folder that is no group', 'changes/security/1.md', 'changes/security: not a group'],
    ['a file that is not Markdown', 'changes/fixed/1.txt', 'changes/fixed/1.txt: not a .md file'],
    ['a file outside the groups', 'changes/1.md', 'changes/1.md: not in a group folder'],
  ])('refuses %s, naming it', (_, file, message) => {
    write(file, 'Text.\n');

    expect(() => readChangeEntries(root)).toThrow(message);
  });

  it('refuses an empty entry', () => {
    write('changes/fixed/1.md', '\n  \n');

    expect(() => readChangeEntries(root)).toThrow('changes/fixed/1.md: the entry is empty');
  });
});
