// @vitest-environment node
/**
 * `scripts/release/update-pages.sh` against a throwaway bare repository standing in for GitHub. The
 * script publishes the project site and the update manifest on the `gh-pages` branch, which GitHub
 * Pages serves: what the test reads back from that branch is what installed copies would download.
 * A release signed on AMO's unlisted channel is the self-distributed build, which names that
 * update manifest; one signed on the listed channel names none, so a copy that updates to it
 * updates from addons.mozilla.org afterwards.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAddOnId } from '../../src/lib/get-add-on-id';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { getGeckoSettings } from './get-gecko-settings';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/release/update-pages.sh');
const SIGNATURE = ['META-INF/cose.sig', 'META-INF/mozilla.rsa'];

let folder = '';
let remote = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-pages-')));
  remote = path.join(folder, 'remote.git');
  git(folder, 'init', '--quiet', '--bare', remote);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

type Channel = 'listed' | 'unlisted';

/**
 * An XPI as the release would download it: a zip with the manifest, the licence and the notices
 * every build writes, and, when signed, AMO's files. The build is the one of the channel: the
 * self-distributed build for unlisted, the default build for listed.
 */
function xpi(
  version: string,
  {
    signed = true,
    manifestVersion = version,
    channel = 'unlisted',
  }: { signed?: boolean; manifestVersion?: string; channel?: Channel } = {},
): string {
  const content = path.join(folder, `content-${version}-${signed}-${channel}`);
  mkdirSync(path.join(content, 'META-INF'), { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Zen Recorder',
    version: manifestVersion,
    browser_specific_settings: {
      gecko: getGeckoSettings(channel === 'unlisted' ? 'self' : undefined),
    },
  };
  writeFileSync(path.join(content, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(content, 'LICENSE'), 'MIT License');
  writeFileSync(path.join(content, 'THIRD-PARTY-NOTICES.md'), '# Third-party notices');
  const files = [
    'manifest.json',
    'LICENSE',
    'THIRD-PARTY-NOTICES.md',
    ...(signed ? SIGNATURE : []),
  ];
  for (const file of signed ? SIGNATURE : []) writeFileSync(path.join(content, file), version);
  const file = path.join(folder, `zen-recorder-${version}-${signed}-${channel}.xpi`);
  const zip = spawnSync('zip', ['-q', '-X', file, ...files], { cwd: content, encoding: 'utf8' });
  expect(zip.status).toBe(0);
  return file;
}

const link = (version: string) =>
  `https://github.com/zenfully-org/zen-recorder/releases/download/v${version}/zen-recorder-${version}.xpi`;

function publish(
  version: string,
  file: string,
  { channel = 'unlisted', extra = [] }: { channel?: Channel; extra?: string[] } = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    'bash',
    [SCRIPT, '--remote', remote, '--channel', channel, ...extra, version, file, link(version)],
    { cwd: REPO, encoding: 'utf8' },
  );
}

/**
 * The `gh-pages` branch as GitHub Pages would serve it, or nothing when there is no such branch.
 * It is read in the bare repository itself: each git command is a process to start, and a clone
 * per check made these tests slower than they need to be.
 */
function pages(): { files: string[]; read: (file: string) => string; commits: number } | null {
  const heads = git(folder, '--git-dir', remote, 'branch', '--list', 'gh-pages');
  if (heads.trim() === '') return null;
  const files = git(folder, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'gh-pages')
    .trim()
    .split('\n');
  const commits = Number(git(folder, '--git-dir', remote, 'rev-list', '--count', 'gh-pages'));
  return {
    files,
    read: (file) => git(folder, '--git-dir', remote, 'show', `gh-pages:${file}`),
    commits,
  };
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

// The release runs this script on Ubuntu, and its tests build XPIs with zip and unzip, which
// Windows has not: they run everywhere else. Each test starts processes, not just code: bash, git
// several times, zip, and Node with tsx for the update manifest, about 0.3 s of CPU per publish.
// They take 0.2-0.6 s on an idle machine and a few times that when the machine is busy.
describe.skipIf(process.platform === 'win32')(
  'update-pages.sh',
  { timeout: PROCESS_BUDGET_MS },
  () => {
    it('publishes the site and an update manifest with the first release', () => {
      const file = xpi('0.4.0');

      const result = publish('0.4.0', file);

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('published 0.4.0 on gh-pages');
      const published = pages();
      expect(published?.files).toEqual(['.nojekyll', 'index.html', 'privacy.html', 'updates.json']);
      expect(published?.read('index.html')).toBe(
        readFileSync(path.join(REPO, 'site/index.html'), 'utf8'),
      );
      expect(JSON.parse(published?.read('updates.json') ?? '')).toEqual({
        addons: {
          [getAddOnId()]: {
            updates: [
              {
                version: '0.4.0',
                update_link: link('0.4.0'),
                update_hash: `sha256:${sha256(file)}`,
                applications: { gecko: { strict_min_version: '140.0' } },
              },
            ],
          },
        },
      });
      expect(published?.commits).toBe(1);
    });

    it('adds the next release to the published manifest and keeps the earlier one', () => {
      expect(publish('0.4.0', xpi('0.4.0')).status).toBe(0);

      const result = publish('0.4.1', xpi('0.4.1'));

      expect(result.status).toBe(0);
      const published = pages();
      const manifest = JSON.parse(published?.read('updates.json') ?? '');
      expect(
        manifest.addons[getAddOnId()].updates.map((u: { version: string }) => u.version),
      ).toEqual(['0.4.0', '0.4.1']);
      expect(published?.commits).toBe(2);
    });

    it('commits nothing when the same release is published again', () => {
      const file = xpi('0.4.0');
      expect(publish('0.4.0', file).status).toBe(0);

      const result = publish('0.4.0', file);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('gh-pages already has 0.4.0: nothing to publish');
      expect(pages()?.commits).toBe(1);
    });

    it('mirrors the site folder, so a page removed from it leaves the published site too', () => {
      const site = path.join(folder, 'site');
      mkdirSync(site);
      writeFileSync(path.join(site, 'index.html'), 'home');
      writeFileSync(path.join(site, 'old.html'), 'old');
      expect(publish('0.4.0', xpi('0.4.0'), { extra: ['--site', site] }).status).toBe(0);
      rmSync(path.join(site, 'old.html'));

      expect(publish('0.4.1', xpi('0.4.1'), { extra: ['--site', site] }).status).toBe(0);

      expect(pages()?.files).toEqual(['.nojekyll', 'index.html', 'updates.json']);
    });

    it('moves copies installed from GitHub to the listed build: its entry follows the unlisted ones', () => {
      expect(publish('0.4.0', xpi('0.4.0')).status).toBe(0);
      const listed = xpi('0.5.0', { channel: 'listed' });

      const result = publish('0.5.0', listed, { channel: 'listed' });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const updates = JSON.parse(pages()?.read('updates.json') ?? '').addons[getAddOnId()].updates;
      expect(updates.map((u: { version: string }) => u.version)).toEqual(['0.4.0', '0.5.0']);
      expect(updates[1]).toEqual({
        version: '0.5.0',
        update_link: link('0.5.0'),
        update_hash: `sha256:${sha256(listed)}`,
        applications: { gecko: { strict_min_version: '140.0' } },
      });
    });

    it('refuses the self-distributed XPI on the listed channel and publishes nothing', () => {
      const result = publish('0.5.0', xpi('0.5.0'), { channel: 'listed' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the XPI names an update_url');
      expect(pages()).toBeNull();
    });

    it('refuses a listed XPI on the unlisted channel, whose copies would never update, and publishes nothing', () => {
      const result = publish('0.4.0', xpi('0.4.0', { channel: 'listed' }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the XPI names no update_url');
      expect(pages()).toBeNull();
    });

    it('refuses an unsigned XPI and publishes nothing', () => {
      const result = publish('0.4.0', xpi('0.4.0', { signed: false }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the XPI is not signed');
      expect(pages()).toBeNull();
    });

    it('refuses an XPI of another version and publishes nothing', () => {
      const result = publish('0.4.0', xpi('0.4.0', { manifestVersion: '0.3.0' }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the XPI is version 0.3.0, not 0.4.0');
      expect(pages()).toBeNull();
    });

    it('refuses to replace a published manifest it cannot read, and leaves the branch as it was', () => {
      expect(publish('0.4.0', xpi('0.4.0')).status).toBe(0);
      const checkout = path.join(folder, 'broken');
      git(folder, 'clone', '--quiet', '--branch', 'gh-pages', remote, checkout);
      writeFileSync(path.join(checkout, 'updates.json'), '<!doctype html>');
      git(
        checkout,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.org',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-am',
        'break it',
      );
      git(checkout, 'push', '--quiet', 'origin', 'gh-pages');

      const result = publish('0.4.1', xpi('0.4.1'));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the published updates.json is not an update manifest');
      expect(pages()?.commits).toBe(2);
    });

    it.each([
      { name: 'no arguments', args: [] },
      { name: 'a missing link', args: ['0.4.0', 'zen-recorder-0.4.0.xpi'] },
      { name: 'an option without its value', args: ['--remote'] },
      {
        name: 'an unknown option',
        args: ['--branch', 'main', '0.4.0', 'a.xpi', 'https://a/b.xpi'],
      },
      { name: 'no channel', args: ['0.4.0', 'a.xpi', 'https://a/b.xpi'] },
      {
        name: 'a channel AMO does not have',
        args: ['--channel', 'self', '0.4.0', 'a.xpi', 'https://a/b.xpi'],
      },
    ])('prints its usage and exits 2 on $name', ({ args }) => {
      const result = spawnSync('bash', [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage: ');
    });

    it('exits 2 on an XPI it cannot read', () => {
      const result = publish('0.4.0', path.join(folder, 'missing.xpi'));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot read');
      expect(pages()).toBeNull();
    });
  },
);
