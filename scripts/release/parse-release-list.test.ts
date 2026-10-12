// @vitest-environment node
/**
 * The release workflow and the hourly check read the repository's releases from GitHub's API
 * (`GET repos/<repo>/releases`) to decide what to publish: the parser keeps what they need and
 * refuses an answer that is not a list of releases rather than guessing.
 */
import { parseReleaseList } from './parse-release-list';

// Trimmed from GET repos/zenfully-org/zen-recorder/releases, 2026-10-12.
const ANSWER = [
  {
    url: 'https://api.github.com/repos/zenfully-org/zen-recorder/releases/1',
    tag_name: 'v0.4.0',
    name: 'Zen Recorder 0.4.0 (unsigned pre-release)',
    draft: false,
    prerelease: true,
    created_at: '2026-10-10T22:48:53Z',
    assets: [
      { name: 'zen-recorder-0.4.0-sources.zip', size: 1056466, state: 'uploaded' },
      { name: 'zen-recorder-0.4.0-unsigned.xpi', size: 760061, state: 'uploaded' },
    ],
  },
];

describe('parseReleaseList', () => {
  it('reads each release tag, whether it is a draft or a pre-release, and its files', () => {
    expect(parseReleaseList(ANSWER)).toEqual([
      {
        tag: 'v0.4.0',
        draft: false,
        prerelease: true,
        assets: ['zen-recorder-0.4.0-sources.zip', 'zen-recorder-0.4.0-unsigned.xpi'],
      },
    ]);
  });

  it('reads a repository without releases', () => {
    expect(parseReleaseList([])).toEqual([]);
  });

  it.each([
    { name: 'an error message', answer: { message: 'Not Found', status: '404' } },
    {
      name: 'a release without its tag',
      answer: [{ draft: false, prerelease: false, assets: [] }],
    },
    { name: 'text', answer: 'Bad credentials' },
  ])('refuses $name', ({ answer }) => {
    expect(() => parseReleaseList(answer)).toThrow(
      `GitHub's answer is not a list of releases: ${JSON.stringify(answer)}`,
    );
  });
});
