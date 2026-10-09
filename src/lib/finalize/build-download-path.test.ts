import { describe, expect, it } from 'vitest';
import { buildDownloadPath } from './build-download-path';

const startedAt = new Date(2026, 8, 2, 14, 5).getTime();
const base = {
  template: '{date}_{time}_{title}',
  subfolder: 'zen-recorder',
  title: 'Design review',
  meetingCode: 'abc-defg-hij',
  provider: 'meet',
  startedAt,
  extension: 'webm',
};

describe('buildDownloadPath', () => {
  it('renders the template inside the subfolder', () => {
    expect(buildDownloadPath(base)).toBe('zen-recorder/2026-09-02_14-05_Design review.webm');
  });

  it('supports the {code} token, a suffix and no subfolder', () => {
    expect(
      buildDownloadPath({ ...base, template: '{code}', subfolder: '', suffix: '(recovered)' }),
    ).toBe('abc-defg-hij (recovered).webm');
  });

  it('supports the {provider} token', () => {
    expect(buildDownloadPath({ ...base, template: '{provider}_{title}', provider: 'teams' })).toBe(
      'zen-recorder/teams_Design review.webm',
    );
  });

  it('falls back to a dated name when the template renders to nothing usable', () => {
    expect(buildDownloadPath({ ...base, template: '...', title: '' })).toBe(
      'zen-recorder/2026-09-02_14-05_recording.webm',
    );
  });

  it('ignores a suffix that sanitizes to nothing', () => {
    expect(buildDownloadPath({ ...base, suffix: '?' })).toBe(
      'zen-recorder/2026-09-02_14-05_Design review.webm',
    );
  });

  // ext4 takes 255 bytes per name, and Firefox writes `<name>.part` first, so a name above 250
  // bytes fails with FILE_FAILED. Firefox may add `(N)` up to `(9999)` when the name is taken.
  it.each([
    { name: 'ASCII', title: 'a'.repeat(300) },
    { name: 'two-byte letters', title: 'é'.repeat(300) },
    { name: 'CJK', title: '会'.repeat(300) },
    { name: 'emoji', title: '🎉'.repeat(300) },
  ])('keeps a long $name title within 255 bytes on disk', ({ title }) => {
    const path = buildDownloadPath({
      ...base,
      template: '{title}',
      title,
      suffix: '(recovered) raw',
    });
    const leaf = path.slice(path.lastIndexOf('/') + 1);
    const partFile = leaf.replace(/\.webm$/, '(9999).webm.part');
    expect(new TextEncoder().encode(partFile).length).toBeLessThanOrEqual(255);
  });

  it('sanitizes the subfolder', () => {
    expect(buildDownloadPath({ ...base, subfolder: 'my:folder' })).toBe(
      'my folder/2026-09-02_14-05_Design review.webm',
    );
  });

  it('keeps the subfolder from ending in an extension Firefox would make `.download`', () => {
    expect(buildDownloadPath({ ...base, subfolder: 'meetings.local' })).toBe(
      'meetings_local/2026-09-02_14-05_Design review.webm',
    );
  });
});
