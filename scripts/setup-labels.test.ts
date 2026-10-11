// @vitest-environment node
/**
 * `scripts/setup-labels.sh` run against a fake `gh` placed first on the `PATH`: the fake writes
 * down every call and answers like the real one, so the test sees exactly what the script would
 * ask GitHub to do, without a network or a repository.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from './process-budget';

const REPO = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(REPO, 'scripts/setup-labels.sh');
const FORMS = path.join(REPO, '.github/ISSUE_TEMPLATE');
const DEPENDABOT = path.join(REPO, '.github/dependabot.yml');

// Writes each call as its arguments separated by NUL, one call per line. With FAKE_GH_REFUSE set,
// it refuses the call for that label the way gh does when GitHub answers with an error.
const FAKE_GH = `#!/usr/bin/env bash
{ printf '%s\\0' "$@"; printf '\\n'; } >>"$FAKE_GH_LOG"
if [[ -n "\${FAKE_GH_REFUSE:-}" && "$3" == "$FAKE_GH_REFUSE" ]]; then
  echo 'HTTP 422: Validation Failed' >&2
  exit 1
fi
echo "✓ Label \\"$3\\" created"
`;

let bin = '';
let log = '';

beforeEach(() => {
  bin = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-labels-')));
  log = path.join(bin, 'calls.log');
  writeFileSync(path.join(bin, 'gh'), FAKE_GH);
  chmodSync(path.join(bin, 'gh'), 0o755);
  writeFileSync(log, '');
});

afterEach(() => {
  rmSync(bin, { recursive: true, force: true });
});

function run(args: string[] = [], env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_LOG: log, ...env },
    encoding: 'utf8',
  });
}

/** The calls the script made to gh, each as its list of arguments. */
function calls(): string[][] {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\0').slice(0, -1));
}

type Label = { name: string; color: string; description: string; rest: string[] };

/** The labels of `gh label create <name> --color <c> --description <d> …` calls. */
function created(): Label[] {
  return calls().map(([command, action, name = '', colorFlag, color = '', descFlag, ...rest]) => {
    expect([command, action, colorFlag, descFlag]).toEqual([
      'label',
      'create',
      '--color',
      '--description',
    ]);
    const [description = '', ...flags] = rest;
    return { name, color, description, rest: flags };
  });
}

/** The labels an issue form applies, from its `labels: [a, b]` line. */
function formLabels(file: string): string[] {
  const line = readFileSync(path.join(FORMS, file), 'utf8')
    .split('\n')
    .find((text) => text.startsWith('labels:'));
  const list = line?.match(/^labels:\s*\[(.*)\]\s*$/)?.[1];
  if (list === undefined) throw new Error(`${file} has no "labels: [...]" line`);
  return list.split(',').map((label) => label.trim().replace(/^["']|["']$/g, ''));
}

// Each test starts bash on the script, which starts a fake gh.
describe('scripts/setup-labels.sh', { timeout: PROCESS_BUDGET_MS }, () => {
  it('creates each label, or updates the one that exists, and deletes none', () => {
    const result = run();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const labels = created();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.rest).toEqual(['--force']);
    expect(new Set(labels.map((label) => label.name)).size).toBe(labels.length);
  });

  it('says how many labels it set up, since gh prints nothing when not on a terminal', () => {
    const result = run(['--repo', 'someone/elsewhere']);

    expect(result.stdout.split('\n').at(-2)).toBe(
      `setup-labels: ${created().length} labels created or updated on someone/elsewhere`,
    );
  });

  it('names the repository of the current folder when --repo is not given', () => {
    const result = run();

    expect(result.stdout.split('\n').at(-2)).toBe(
      `setup-labels: ${created().length} labels created or updated on the current repository`,
    );
  });

  it("creates the triage labels, one per meeting service and GitHub's defaults", () => {
    run();

    expect(created().map((label) => label.name)).toEqual(
      expect.arrayContaining([
        'needs-triage',
        'accepted',
        'needs-maintainer',
        'open-source',
        'meeting-notes',
        'provider:meet',
        'provider:zoom',
        'provider:teams',
        'dependencies',
        'bug',
        'documentation',
        'duplicate',
        'enhancement',
        'good first issue',
        'help wanted',
        'invalid',
        'question',
        'wontfix',
      ]),
    );
  });

  it('gives every label a colour and a description GitHub accepts', () => {
    run();
    const labels = created();

    expect(labels).not.toEqual([]);
    for (const label of labels) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
      // GitHub refuses a label description longer than 100 characters.
      expect(label.description.length).toBeLessThanOrEqual(100);
    }
  });

  it('creates every label an issue form applies, so none is dropped from a new issue', () => {
    run();
    const names = created().map((label) => label.name);
    const forms = readdirSync(FORMS).filter(
      (file) => /\.ya?ml$/.test(file) && file !== 'config.yml',
    );

    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(formLabels(form)).toContain('needs-triage');
      expect(names).toEqual(expect.arrayContaining(formLabels(form)));
    }
  });

  it('creates every label Dependabot puts on its pull requests, which it would leave off otherwise', () => {
    run();
    const names = created().map((label) => label.name);
    const applied = readFileSync(DEPENDABOT, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const list = line.match(/^\s*labels:\s*\[(.*)\]\s*$/)?.[1];
        return list === undefined ? [] : list.split(',').map((label) => label.trim());
      });

    expect(applied).not.toEqual([]);
    expect(names).toEqual(expect.arrayContaining(applied));
  });

  it('works on the repository --repo names', () => {
    const result = run(['--repo', 'someone/elsewhere']);

    expect(result.status).toBe(0);
    const labels = created();
    expect(labels).not.toEqual([]);
    for (const label of labels) {
      expect(label.rest).toEqual(['--force', '--repo', 'someone/elsewhere']);
    }
  });

  it('stops at the first label GitHub refuses, and names it', () => {
    const result = run([], { FAKE_GH_REFUSE: 'needs-triage' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HTTP 422');
    expect(result.stderr).toContain('setup-labels: could not create or update "needs-triage"');
    expect(created().at(-1)?.name).toBe('needs-triage');
  });

  it.each([
    ['an unknown option', ['--delete']],
    ['--repo without a repository', ['--repo']],
    ['a repository without --repo', ['someone/elsewhere']],
  ])('refuses %s and calls gh never', (_case, args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(calls()).toEqual([]);
  });
});
