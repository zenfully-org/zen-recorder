// @vitest-environment node
/**
 * `scripts/release/check-reproducible-build.sh` rebuilds the extension from a sources zip and
 * compares the build with the XPI, as addons.mozilla.org's reviewers do. Here a fake `corepack`
 * stands in for the real install and build: it records the commands it gets, with the
 * `package.json` of the folder it runs in, and "builds" the files the sources zip carries in
 * `fake-build/`, so each case decides what the build produces.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { PROCESS_BUDGET_MS } from '../process-budget';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/release/check-reproducible-build.sh');
const FAKE_COREPACK = `#!/usr/bin/env bash
printf '%s\\t%s\\n' "$(cat package.json)" "$*" >>"$FAKE_COREPACK_LOG"
if [[ $* == 'pnpm build' ]]; then
  if [[ -n \${FAKE_BUILD_FAILS:-} ]]; then echo 'the build broke' >&2; exit 1; fi
  mkdir -p .output/firefox-mv3
  cp -R fake-build/. .output/firefox-mv3/
  if [[ -n \${ZEN_RECORDER_CHANNEL:-} ]]; then
    printf '%s' "$ZEN_RECORDER_CHANNEL" >.output/firefox-mv3/channel.txt
  fi
fi
`;

type Files = Record<string, string>;

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-reproducible-')));
  mkdirSync(path.join(folder, 'bin'));
  writeFileSync(path.join(folder, 'bin/corepack'), FAKE_COREPACK);
  chmodSync(path.join(folder, 'bin/corepack'), 0o755);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A zip of the given files, written into the test's folder. */
function zip(name: string, files: Files): string {
  const content = path.join(folder, `${name}-content`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(content, file)), { recursive: true });
    writeFileSync(path.join(content, file), text);
  }
  const file = path.join(folder, `${name}.zip`);
  const result = spawnSync('zip', ['-q', '-r', '-X', file, '.'], {
    cwd: content,
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return file;
}

const BUILD: Files = {
  'manifest.json': '{"version":"1.2.3"}',
  'background.js': 'console.log(1)',
  'assets/popup.css': '.flex{display:flex}',
};

/** A sources zip whose (fake) build produces the given files. */
const sources = (build: Files): string =>
  zip(
    'sources',
    Object.fromEntries([
      ['package.json', '{}'],
      ...Object.entries(build).map(([file, text]) => [`fake-build/${file}`, text]),
    ]),
  );

function check(args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      PATH: `${path.join(folder, 'bin')}:${process.env['PATH'] ?? ''}`,
      FAKE_COREPACK_LOG: path.join(folder, 'corepack.log'),
    },
  });
}

/** The commands the fake corepack got, each with the `package.json` of the folder it ran in. */
const corepackCalls = (): { packageJson: string; command: string }[] =>
  readFileSync(path.join(folder, 'corepack.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [packageJson = '', command = ''] = line.split('\t');
      return { packageJson, command };
    });

const onWindows = process.platform === 'win32';

// The release runs this script on Ubuntu, and its tests build XPIs with zip and unzip, which
// Windows has not: they run everywhere else. Each test starts zip to build the archives, then
// bash on the check, which starts more.
describe.skipIf(onWindows)('check-reproducible-build.sh', { timeout: PROCESS_BUDGET_MS }, () => {
  it('passes when the build from the sources holds exactly the files of the XPI', () => {
    const result = check([zip('xpi', BUILD), sources(BUILD)]);

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('the build from the sources equals the XPI (3 files)');
    expect(result.status).toBe(0);
  });

  it.each([
    [
      'a file differs',
      { ...BUILD, 'assets/popup.css': '.flex{display:flex}.p-2{padding:.5rem}' },
      'Files XPI/assets/popup.css and build/assets/popup.css differ',
    ],
    ['the build has a file more', { ...BUILD, 'extra.js': 'x' }, 'Only in build: extra.js'],
    [
      'the build lacks a file',
      { 'manifest.json': '{"version":"1.2.3"}', 'assets/popup.css': '.flex{display:flex}' },
      'Only in XPI: background.js',
    ],
  ])('fails and names the file when %s', (_case, build, line) => {
    const result = check([zip('xpi', BUILD), sources(build)]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the build from the sources differs from the XPI');
    expect(result.stderr).toContain(line);
  });

  it("leaves Mozilla's signature out, so a signed XPI can be checked", () => {
    const signed = zip('xpi', {
      ...BUILD,
      'META-INF/cose.sig': 'signature',
      'META-INF/mozilla.rsa': 'signature',
    });

    expect(check([signed, sources(BUILD)]).status).toBe(0);
  });

  it('runs the commands of README-REVIEWERS.md, in the unpacked sources', () => {
    const readme = readFileSync(path.join(REPO, 'README-REVIEWERS.md'), 'utf8');
    const block = /\n## Build\n[\s\S]*?```sh\n([\s\S]*?)\n```/.exec(readme)?.[1] ?? '';
    const commands = block
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean);

    expect(check([zip('xpi', BUILD), sources(BUILD)]).status).toBe(0);
    const calls = corepackCalls();
    expect(calls.map((call) => `corepack ${call.command}`)).toEqual(commands);
    expect(calls.map((call) => call.packageJson)).toEqual(commands.map(() => '{}'));
  });

  it('names in README-REVIEWERS.md the Node.js of .nvmrc and the pnpm of package.json', () => {
    const readme = readFileSync(path.join(REPO, 'README-REVIEWERS.md'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    const node = readFileSync(path.join(REPO, '.nvmrc'), 'utf8').trim();
    const pnpm = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
      z
        .object({ packageManager: z.string() })
        .parse(JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'))).packageManager,
    )?.[1];

    expect(readme).toContain(`**Node.js ${node}**`);
    expect(readme).toContain(`pnpm ${pnpm}`);
  });

  it('builds with the environment it is given, such as the release channel', () => {
    const xpi = zip('xpi', { ...BUILD, 'channel.txt': 'self' });

    expect(check([xpi, sources(BUILD)]).status).toBe(1);
    expect(check([xpi, sources(BUILD)], { ZEN_RECORDER_CHANNEL: 'self' }).status).toBe(0);
  });

  it("fails with the build's output when the build fails", () => {
    const result = check([zip('xpi', BUILD), sources(BUILD)], { FAKE_BUILD_FAILS: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the build broke');
    expect(result.stderr).toContain('the build from the sources failed');
  });

  it.each([
    ['no arguments', () => []],
    ['one argument', () => [zip('xpi', BUILD)]],
    ['an XPI it cannot read', () => [path.join(folder, 'missing.xpi'), sources(BUILD)]],
    ['sources it cannot read', () => [zip('xpi', BUILD), path.join(folder, 'missing.zip')]],
  ])('stops with status 2 on %s', (_case, args) => {
    const result = check(args());

    expect(result.status).toBe(2);
    expect(result.stderr).not.toBe('');
  });
});
