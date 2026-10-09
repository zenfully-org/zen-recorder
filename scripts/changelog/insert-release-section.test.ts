// @vitest-environment node
import { insertReleaseSection } from './insert-release-section';

const CHANGELOG = [
  '# Changelog',
  '',
  'What changed.',
  '',
  '## Unreleased',
  '',
  'The entries of the next release wait in `changes/`.',
  '',
  '## 0.3.0 - 2026-10-01',
  '',
  '### Added',
  '',
  '- An old feature.',
  '',
].join('\n');

const GROUPS = '### Fixed\n\n- A fix. (#72)';

describe('insertReleaseSection', () => {
  it('puts the release right below Unreleased, which keeps its note, and above the last release', () => {
    expect(insertReleaseSection(CHANGELOG, '0.4.0', '2026-10-09', GROUPS)).toBe(
      [
        '# Changelog',
        '',
        'What changed.',
        '',
        '## Unreleased',
        '',
        'The entries of the next release wait in `changes/`.',
        '',
        '## 0.4.0 - 2026-10-09',
        '',
        '### Fixed',
        '',
        '- A fix. (#72)',
        '',
        '## 0.3.0 - 2026-10-01',
        '',
        '### Added',
        '',
        '- An old feature.',
        '',
      ].join('\n'),
    );
  });

  it('puts the release at the end when no release came before', () => {
    const first = '# Changelog\n\n## Unreleased\n\nThe note.\n';

    expect(insertReleaseSection(first, '0.1.0', '2026-09-01', GROUPS)).toBe(
      '# Changelog\n\n## Unreleased\n\nThe note.\n\n## 0.1.0 - 2026-09-01\n\n### Fixed\n\n- A fix. (#72)\n',
    );
  });

  it.each([
    ['a changelog without Unreleased', '# Changelog\n', '0.4.0', 'has no "## Unreleased" section'],
    ['a version it already has', CHANGELOG, '0.3.0', 'already has a section for 0.3.0'],
  ])('refuses %s', (_, changelog, version, message) => {
    expect(() => insertReleaseSection(changelog, version, '2026-10-09', GROUPS)).toThrow(message);
  });
});
