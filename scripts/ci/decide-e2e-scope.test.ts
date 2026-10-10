// @vitest-environment node
/**
 * The end-to-end scenarios take about 25 minutes per meeting service, so CI runs them where a
 * change can affect them: on a pull request and in the merge queue, for the services whose code
 * the change touches (all of them when it touches shared code, none for documentation); in full
 * on a release, at night and when asked; and not on the push to main, whose commit the merge
 * queue has just tested. A change whose files cannot be listed runs everything.
 */
import { decideE2eScope } from './decide-e2e-scope';

const PROVIDERS = ['meet', 'zoom', 'teams'];
const base = {
  event: 'pull_request',
  ref: 'refs/pull/12/merge',
  defaultBranch: 'main',
  full: false,
  providers: PROVIDERS,
};

const scopeOf = (changedFiles: readonly string[], event = 'pull_request') =>
  decideE2eScope({ ...base, event, changedFiles }).providers;

describe('decideE2eScope', () => {
  describe.each(['pull_request', 'merge_group'])('on %s', (event) => {
    it('runs every service for a change to shared code', () => {
      expect(scopeOf(['src/lib/page/create-page-session.ts'], event)).toEqual(PROVIDERS);
    });

    it('runs one service for a change to its provider alone', () => {
      expect(
        scopeOf(
          ['src/lib/providers/zoom/read-zoom-waiting-room.ts', 'src/entrypoints/zoom.content.ts'],
          event,
        ),
      ).toEqual(['zoom']);
    });

    it('runs nothing for documentation alone', () => {
      expect(
        scopeOf(
          [
            'README.md',
            'docs/user-guide.md',
            'docs/assets/status-card-in-call.png',
            'changes/fixed/12.md',
          ],
          event,
        ),
      ).toEqual([]);
    });
  });

  it.each([
    'src/lib/providers/meet/read-meet-participant-count.ts',
    'src/entrypoints/meet.content.ts',
    'src/entrypoints/meet-hook.content.ts',
    'src/test/fakes/create-fake-meet-page.ts',
    'src/test/fixtures/fake-meet.html',
    'scripts/e2e/scenario-meet-counts-people.ts',
  ])("counts %s as Google Meet's alone", (file) => {
    expect(scopeOf([file])).toEqual(['meet']);
  });

  it('runs the services of each provider a change touches, in the order given', () => {
    expect(
      scopeOf(['src/test/fixtures/fake-teams.html', 'src/lib/providers/meet/read-meet-tiles.ts']),
    ).toEqual(['meet', 'teams']);
  });

  it.each([
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'README-REVIEWERS.md',
    'LICENSE',
    'docs/store/listing.md',
    'docs/meeting-notes.schema.json',
    'changes/README.md',
    'site/index.html',
    '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/pull_request_template.md',
    '.github/release-notes-footer.md',
    '.github/amo-metadata/listed.json',
    '.github/dependabot.yml',
    '.github/workflows/release.yml',
    '.github/workflows/start-release.yml',
    '.github/workflows/soak.yml',
    '.github/workflows/quality-baseline.yml',
    'scripts/release/judge-release-start.ts',
    'scripts/release-notes.sh',
    'scripts/changelog/read-change-entries.ts',
    'src/lib/page/create-page-session.test.ts',
    'src/lib/providers/meet/read-meet-participant-count.test.ts',
    'scripts/e2e/order-scenarios.test.ts',
    'knip.jsonc',
    'quality-baseline.json',
    '.jscpd-baseline.json',
    'eslint.config.js',
    'biome.json',
    '.dependency-cruiser.cjs',
    'vitest.config.ts',
    '.gitattributes',
    'scripts/quality/eslint-config.ts',
    'scripts/zip/list-tracked-sources.ts',
    'scripts/check-conventions.ts',
    'scripts/check-identity.sh',
  ])('needs no end-to-end run for %s', (file) => {
    expect(scopeOf([file])).toEqual([]);
  });

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'wxt.config.ts',
    '.nvmrc',
    '.github/workflows/ci.yml',
    'scripts/ci/run-step.ts',
    'scripts/e2e/harness.ts',
    'scripts/e2e-fixture.ts',
    'src/lib/providers/types.ts',
    'src/lib/providers/get-provider-catalog.ts',
    'src/test/fakes/create-fake-meeting-provider.ts',
    'src/test/fixtures/meeting-notes-v1.md',
    'src/entrypoints/background.ts',
    'src/lib/notes/README.md',
  ])('runs every service for %s', (file) => {
    expect(scopeOf([file])).toEqual(PROVIDERS);
  });

  it('runs every service when the changed files could not be listed', () => {
    expect(decideE2eScope({ ...base, changedFiles: undefined })).toEqual({
      providers: PROVIDERS,
      reason: 'the changed files could not be listed, so every service runs',
    });
  });

  it('names what it chose and why', () => {
    expect(decideE2eScope({ ...base, changedFiles: ['README.md'] }).reason).toBe(
      'the change touches no file the end-to-end scenarios depend on',
    );
    expect(
      decideE2eScope({ ...base, changedFiles: ['src/lib/providers/teams/read-teams-roster.ts'] })
        .reason,
    ).toBe('the change touches the code of teams alone');
    expect(decideE2eScope({ ...base, changedFiles: ['src/lib/page/x.ts'] }).reason).toBe(
      'the change touches shared code: src/lib/page/x.ts',
    );
  });

  it('skips the push to the default branch: the merge queue tested that commit', () => {
    expect(
      decideE2eScope({ ...base, event: 'push', ref: 'refs/heads/main', changedFiles: undefined }),
    ).toEqual({
      providers: [],
      reason:
        'the merge queue ran the end-to-end scenarios on this commit before it landed on main',
    });
  });

  it.each([
    ['a pushed release tag', 'push', 'refs/tags/v0.4.0'],
    ['a push to another branch', 'push', 'refs/heads/some-branch'],
    ['the nightly run', 'schedule', 'refs/heads/main'],
    ['a run started by hand', 'workflow_dispatch', 'refs/heads/main'],
  ])('runs everything for %s', (_, event, ref) => {
    expect(decideE2eScope({ ...base, event, ref, changedFiles: undefined }).providers).toEqual(
      PROVIDERS,
    );
  });

  it('runs everything when a full run is asked for, whatever the change', () => {
    expect(decideE2eScope({ ...base, full: true, changedFiles: ['README.md'] })).toEqual({
      providers: PROVIDERS,
      reason: 'a full run was asked for',
    });
  });
});
