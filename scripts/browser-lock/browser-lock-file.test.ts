import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserLockFile } from './browser-lock-file';

describe('browserLockFile', () => {
  it("is one file per machine by default, in the system's temporary folder", () => {
    expect(browserLockFile({})).toBe(path.join(tmpdir(), 'zen-recorder-browser.lock'));
  });

  it('is the file ZEN_RECORDER_BROWSER_LOCK names', () => {
    expect(browserLockFile({ ZEN_RECORDER_BROWSER_LOCK: '/shared/browser.lock' })).toBe(
      '/shared/browser.lock',
    );
  });

  it('ignores an empty ZEN_RECORDER_BROWSER_LOCK', () => {
    expect(browserLockFile({ ZEN_RECORDER_BROWSER_LOCK: '' })).toBe(
      path.join(tmpdir(), 'zen-recorder-browser.lock'),
    );
  });
});
