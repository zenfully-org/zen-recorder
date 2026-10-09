import { describe, expect, it } from 'vitest';
import { buildDownloadPath } from '@/lib/finalize/build-download-path';
import { notesPathFor } from './notes-path-for';

describe('notesPathFor', () => {
  it.each<[string, string, string, string | null]>([
    ['a uniquified name', '/srv/a/zen-recorder/X(1).webm', 'zen-recorder', 'zen-recorder/X(1).md'],
    ['a Windows path', 'D:\\a\\zen-recorder\\X.webm', 'zen-recorder', 'zen-recorder/X.md'],
    [
      'a recovered file',
      '/d/zen-recorder/X (recovered).webm',
      'zen-recorder',
      'zen-recorder/X (recovered).md',
    ],
    ['an audio file', '/d/zen-recorder/X.ogg', 'zen-recorder', 'zen-recorder/X.md'],
    [
      'a name with dots',
      '/d/zen-recorder/v1.2 sync.webm',
      'zen-recorder',
      'zen-recorder/v1.2 sync.md',
    ],
    ['no extension', '/d/zen-recorder/X', 'zen-recorder', 'zen-recorder/X.md'],
    ['no subfolder', '/d/X.webm', '', 'X.md'],
    ['an empty name', '', 'zen-recorder', null],
    ['a path that ends in a folder', '/d/zen-recorder/', 'zen-recorder', null],
    ['a name that is only an extension', '/d/zen-recorder/.webm', 'zen-recorder', null],
  ])('%s', (_label, saved, subfolder, expected) => {
    expect(notesPathFor(saved, subfolder)).toBe(expected);
  });

  // The notes go into the folder the recording was saved in, whatever the setting holds.
  it.each(['zen-recorder', 'meetings.local', ' My <calls> ', 'a/b'])(
    'puts the notes in the folder the recording is saved in, for the setting %j',
    (subfolder) => {
      const recording = buildDownloadPath({
        template: 'X',
        subfolder,
        title: '',
        meetingCode: '',
        provider: 'meet',
        startedAt: 0,
        extension: 'webm',
      });
      expect(notesPathFor(`/d/${recording}`, subfolder)).toBe(recording.replace(/\.webm$/, '.md'));
    },
  );
});
