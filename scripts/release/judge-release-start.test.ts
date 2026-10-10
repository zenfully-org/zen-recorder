// @vitest-environment node
/**
 * A release starts from main by hand ("Start a release"), which tags the commit and runs the
 * release on that tag. It must not tag a version that is released already, nor a commit whose CI
 * did not pass: a tag is permanent, and its release goes to addons.mozilla.org.
 */
import { judgeReleaseStart } from './judge-release-start';

const REQUIRED = ['Gate', 'Reproducible build', 'E2E (meet)'];
const passed = (name: string) => ({ name, status: 'completed', conclusion: 'success' });

describe('judgeReleaseStart', () => {
  it('starts the release of a new version whose required checks all passed on the commit', () => {
    expect(
      judgeReleaseStart({
        version: '0.4.0',
        tagExists: false,
        requiredChecks: REQUIRED,
        checkRuns: REQUIRED.map(passed),
      }),
    ).toEqual({ ok: true, tag: 'v0.4.0' });
  });

  it('refuses a version that is tagged already', () => {
    const verdict = judgeReleaseStart({
      version: '0.4.0',
      tagExists: true,
      requiredChecks: REQUIRED,
      checkRuns: REQUIRED.map(passed),
    });

    expect(verdict).toEqual({
      ok: false,
      problems: [
        'v0.4.0 exists already: a release pull request raises the version in package.json first.',
      ],
    });
  });

  it('takes a check that passed in one run of the commit while another run is still going', () => {
    // A commit on main is tested twice: by the merge queue before it lands, and by the push to main.
    const checkRuns = [
      ...REQUIRED.map(passed),
      { name: 'E2E (meet)', status: 'in_progress', conclusion: null },
    ];

    expect(
      judgeReleaseStart({
        version: '0.4.0',
        tagExists: false,
        requiredChecks: REQUIRED,
        checkRuns,
      }),
    ).toEqual({ ok: true, tag: 'v0.4.0' });
  });

  it('refuses a commit where a required check failed, even when another run of it passed', () => {
    const checkRuns = [
      ...REQUIRED.map(passed),
      { name: 'E2E (meet)', status: 'completed', conclusion: 'failure' },
    ];

    expect(
      judgeReleaseStart({
        version: '0.4.0',
        tagExists: false,
        requiredChecks: REQUIRED,
        checkRuns,
      }),
    ).toEqual({
      ok: false,
      problems: ['"E2E (meet)" failed on this commit: run it again, and start once it passes.'],
    });
  });

  it.each(['cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])(
    'counts a check that ended %s as failed',
    (conclusion) => {
      const checkRuns = [
        passed('Gate'),
        passed('Reproducible build'),
        { name: 'E2E (meet)', status: 'completed', conclusion },
      ];

      expect(
        judgeReleaseStart({
          version: '0.4.0',
          tagExists: false,
          requiredChecks: REQUIRED,
          checkRuns,
        }),
      ).toEqual({
        ok: false,
        problems: ['"E2E (meet)" failed on this commit: run it again, and start once it passes.'],
      });
    },
  );

  it.each([
    ['has no run on the commit', []],
    ['is still running', [{ name: 'E2E (meet)', status: 'in_progress', conclusion: null }]],
    ['was skipped', [{ name: 'E2E (meet)', status: 'completed', conclusion: 'skipped' }]],
  ])('waits for a required check that %s', (_, others) => {
    const checkRuns = [passed('Gate'), passed('Reproducible build'), ...others];

    expect(
      judgeReleaseStart({
        version: '0.4.0',
        tagExists: false,
        requiredChecks: REQUIRED,
        checkRuns,
      }),
    ).toEqual({
      ok: false,
      problems: ['"E2E (meet)" has not passed on this commit yet: wait for CI, then start again.'],
    });
  });

  it('names every problem at once', () => {
    const verdict = judgeReleaseStart({
      version: '0.4.0',
      tagExists: true,
      requiredChecks: REQUIRED,
      checkRuns: [
        passed('Gate'),
        { name: 'Reproducible build', status: 'completed', conclusion: 'failure' },
      ],
    });

    expect(verdict.ok ? [] : verdict.problems).toHaveLength(3);
  });

  it('refuses to judge without the list of required checks', () => {
    expect(
      judgeReleaseStart({ version: '0.4.0', tagExists: false, requiredChecks: [], checkRuns: [] }),
    ).toEqual({
      ok: false,
      problems: [
        "main names no required check, so this commit's CI cannot be judged: check the branch's ruleset.",
      ],
    });
  });
});
