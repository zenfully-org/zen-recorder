// @vitest-environment node
import { readRunInfo } from './read-run-info';

const ENV = {
  GITHUB_WORKFLOW: 'CI',
  GITHUB_RUN_ID: '37842080740',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_SHA: 'abc123',
  GITHUB_REF: 'refs/pull/61/merge',
  GITHUB_EVENT_NAME: 'pull_request',
};

describe('readRunInfo', () => {
  it("reads the run from GitHub's variables, with the address of its page", () => {
    expect(readRunInfo(ENV)).toEqual({
      workflow: 'CI',
      id: 37842080740,
      attempt: 2,
      url: 'https://github.com/owner/repo/actions/runs/37842080740',
      sha: 'abc123',
      ref: 'refs/pull/61/merge',
      event: 'pull_request',
    });
  });

  it('says which variable is missing outside GitHub Actions', () => {
    const { GITHUB_RUN_ID: _, ...rest } = ENV;

    expect(() => readRunInfo(rest)).toThrow(/GITHUB_RUN_ID/);
  });
});
