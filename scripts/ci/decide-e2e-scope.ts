/**
 * Which meeting services' end-to-end runs a CI run needs, and why. The scenarios take about 25
 * minutes per service, so a pull request and the merge queue run them for the services whose code
 * the change touches: all of them for shared code (anything not listed below), one for a change
 * to that service's provider, fake page or own scenario, none for documentation, the changelog,
 * the project site or the release's own files. A release, the nightly run and a run started by
 * hand run everything. The push to main runs none: the merge queue ran them on that exact commit
 * before it landed.
 */
export interface E2eScope {
  providers: string[];
  reason: string;
}

/**
 * Files no end-to-end scenario reads: unit tests (the Gate runs them, and no build includes them),
 * the Gate's own tools and their baselines, documentation, the site, and the release's own files.
 */
const NOT_TESTED_END_TO_END = [
  /\.test\.ts$/,
  /^(\.dependency-cruiser\.cjs|\.jscpd\.json|\.jscpd-baseline\.json|biome\.json|eslint\.config\.js)$/,
  /^(knip\.jsonc|quality-baseline\.json|vitest\.config\.ts|\.gitattributes)$/,
  /^scripts\/(quality|zip)\//,
  /^scripts\/(check-conventions|check-quality)\.ts$/,
  /^scripts\/(check-identity|setup-labels)\.sh$/,
  /^[^/]+\.md$/,
  /^LICENSE$/,
  /^docs\//,
  /^changes\//,
  /^site\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/pull_request_template\.md$/,
  /^\.github\/release-notes-footer\.md$/,
  /^\.github\/amo-metadata\//,
  /^\.github\/dependabot\.yml$/,
  /^\.github\/workflows\/(release|start-release|soak|quality-baseline)\.yml$/,
  /^scripts\/release\//,
  /^scripts\/release-notes\.sh$/,
  /^scripts\/changelog\//,
];

/** The files of one service alone: its provider, its two content scripts, its fake page. */
const ownedBy = (provider: string): RegExp[] => [
  new RegExp(`^src/lib/providers/${provider}/`),
  new RegExp(`^src/entrypoints/${provider}(-hook)?\\.content\\.ts$`),
  new RegExp(`^src/test/fakes/create-fake-${provider}-page\\.ts$`),
  new RegExp(`^src/test/fixtures/fake-${provider}\\.html$`),
  new RegExp(`^scripts/e2e/scenario-${provider}-`),
];

function affectedProviders(
  changedFiles: readonly string[],
  providers: readonly string[],
): E2eScope {
  const touched = new Set<string>();
  for (const file of changedFiles) {
    if (NOT_TESTED_END_TO_END.some((pattern) => pattern.test(file))) continue;
    const owner = providers.find((provider) =>
      ownedBy(provider).some((pattern) => pattern.test(file)),
    );
    if (owner === undefined) {
      return { providers: [...providers], reason: `the change touches shared code: ${file}` };
    }
    touched.add(owner);
  }
  const chosen = providers.filter((provider) => touched.has(provider));
  return chosen.length === 0
    ? { providers: [], reason: 'the change touches no file the end-to-end scenarios depend on' }
    : { providers: chosen, reason: `the change touches the code of ${chosen.join(' and ')} alone` };
}

export function decideE2eScope(input: {
  /** `github.event_name`; a reusable workflow's run has its caller's event. */
  event: string;
  /** `github.ref`. */
  ref: string;
  defaultBranch: string;
  /** A full run asked for by the caller (the release). */
  full: boolean;
  /** The files the pull request or the merge group changes; undefined when they could not be listed. */
  changedFiles: readonly string[] | undefined;
  providers: readonly string[];
}): E2eScope {
  const all = { providers: [...input.providers] };
  if (input.full) return { ...all, reason: 'a full run was asked for' };
  if (input.event === 'push' && input.ref === `refs/heads/${input.defaultBranch}`) {
    return {
      providers: [],
      reason:
        'the merge queue ran the end-to-end scenarios on this commit before it landed on main',
    };
  }
  if (input.event !== 'pull_request' && input.event !== 'merge_group') {
    return { ...all, reason: `a ${input.event} run tests everything` };
  }
  if (input.changedFiles === undefined) {
    return { ...all, reason: 'the changed files could not be listed, so every service runs' };
  }
  return affectedProviders(input.changedFiles, input.providers);
}
