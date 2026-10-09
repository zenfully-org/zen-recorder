import { describe, expect, it } from 'vitest';
import { sanitizeFolderName } from './sanitize-folder-name';

describe('sanitizeFolderName', () => {
  // Firefox appends `.download` to a name whose last extension is one of these, folders included,
  // and then refuses the whole path: every recording failed to save.
  it.each([
    ['meetings.local', 'meetings_local'],
    ['shortcut.lnk', 'shortcut_lnk'],
    ['link.url', 'link_url'],
    ['explorer.scf', 'explorer_scf'],
    ['app.desktop', 'app_desktop'],
    ['Calls.LOCAL', 'Calls_LOCAL'],
    ['a.b.url', 'a.b_url'],
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeFolderName(input)).toBe(expected);
  });

  it.each([
    // Firefox keeps the whitespace in a folder's extension: `. local` is not `.local`.
    'meetings. local',
    'meetings.locale',
    'urls',
    'zen-recorder',
    'notes.webm',
  ])('leaves %j as it is', (input) => {
    expect(sanitizeFolderName(input)).toBe(input);
  });

  it('cleans the rest as any name, and gives no folder for an empty one', () => {
    expect(sanitizeFolderName('my:folder.url')).toBe('my folder_url');
    expect(sanitizeFolderName(' .. ')).toBe('');
  });
});
