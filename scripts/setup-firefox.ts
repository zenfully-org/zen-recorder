/**
 * Downloads the latest Firefox release into `.tools/` for the e2e run and the benchmarks, on Linux,
 * macOS and Windows. Nothing is installed system-wide, so it needs no sudo and no administrator.
 * Which build each platform gets, and where its executable lands, is `firefoxForPlatform`.
 *
 * Usage: `pnpm setup:firefox` (`--help` lists the paths). When the executable is already there it
 * only prints its version; delete its folder under `.tools/` to get a newer release.
 * `pnpm --silent setup:firefox --latest-version` prints the version a download would get now, and
 * downloads nothing: CI keys its copy of `.tools/firefox` by it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type FirefoxForPlatform, firefoxForPlatform } from './e2e/firefox-for-platform';
import { readFirefoxVersion } from './e2e/read-firefox-version';

const TOOLS = path.resolve(import.meta.dirname, '../.tools');

function help(): string {
  const where = (label: string, platform: NodeJS.Platform) =>
    `  ${label.padEnd(9)} .tools/${firefoxForPlatform(platform, 'x64').executable}`;
  return [
    'Usage: pnpm setup:firefox',
    '',
    'Downloads the latest Firefox release (en-US) into .tools/ for the e2e run and the benchmarks.',
    'Nothing is installed system-wide. The executable lands here:',
    where('Linux', 'linux'),
    where('macOS', 'darwin'),
    where('Windows', 'win32'),
    'When it is already there, only its version is printed: delete its folder for a newer release.',
    '--latest-version prints the version a download would get now, and downloads nothing.',
    '',
    'To use a Firefox you installed yourself instead, skip this and set E2E_FIREFOX to its',
    'executable, for example on macOS:',
    '  E2E_FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox pnpm test:e2e',
  ].join('\n');
}

function unpack(archive: string, kind: FirefoxForPlatform['archive']): void {
  switch (kind) {
    case 'tar.xz':
      execFileSync('tar', ['-xJf', archive, '-C', TOOLS], { stdio: 'inherit' });
      return;
    case 'dmg': {
      const mount = mkdtempSync(path.join(tmpdir(), 'firefox-dmg-'));
      execFileSync('hdiutil', [
        'attach',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mount,
        archive,
      ]);
      try {
        execFileSync('cp', ['-R', path.join(mount, 'Firefox.app'), TOOLS]);
      } finally {
        execFileSync('hdiutil', ['detach', mount, '-quiet']);
      }
      rmSync(mount, { recursive: true, force: true });
      return;
    }
    case 'exe':
      // Unpacking needs no administrator, so Windows must not ask for one (RunAsInvoker).
      execFileSync(archive, [`/ExtractDir=${path.join(TOOLS, 'firefox')}`], {
        env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
      });
      return;
  }
}

/** Mozilla's link redirects to the file of the latest release, whose address names its version. */
async function latestRelease(url: string): Promise<{ version: string; url: string }> {
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  const location = response.headers.get('location');
  if (location === null) throw new Error(`no release behind ${url}: HTTP ${response.status}`);
  return { version: readFirefoxVersion(location), url: location };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg === '--help' || arg === '-h')) {
    console.log(help());
    return;
  }
  const firefox = firefoxForPlatform(process.platform, process.arch);
  if (args.includes('--latest-version')) {
    console.log((await latestRelease(firefox.url)).version);
    return;
  }
  const executable = path.join(TOOLS, firefox.executable);
  if (!existsSync(executable)) {
    const release = await latestRelease(firefox.url);
    console.log(`Downloading Firefox ${release.version}: ${release.url}`);
    const response = await fetch(release.url);
    if (!response.ok) throw new Error(`the download failed: HTTP ${response.status}`);
    mkdirSync(TOOLS, { recursive: true });
    // Windows runs the installer only under a name that ends in .exe.
    const archive = path.join(TOOLS, `firefox-download.${firefox.archive}`);
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
    try {
      unpack(archive, firefox.archive);
    } finally {
      rmSync(archive, { force: true });
    }
  }
  console.log(execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim());
}

main().catch((error: unknown) => {
  console.error(`setup:firefox: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
