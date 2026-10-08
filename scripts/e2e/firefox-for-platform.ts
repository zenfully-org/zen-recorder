/**
 * Which Firefox build `pnpm setup:firefox` downloads for this machine, and where its executable
 * lands under `.tools/`. The e2e run and the benchmarks start that executable unless
 * `E2E_FIREFOX` names another one.
 */

export interface FirefoxForPlatform {
  /** Mozilla's address for the latest release, in English (US). */
  url: string;
  /** What the download is: a tarball, a macOS disk image or the Windows installer. */
  archive: 'tar.xz' | 'dmg' | 'exe';
  /** The executable once unpacked, relative to `.tools/`. */
  executable: string;
}

export function firefoxForPlatform(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): FirefoxForPlatform {
  const download = (os: string) =>
    `https://download.mozilla.org/?product=firefox-latest-ssl&os=${os}&lang=en-US`;
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    const os = arch === 'x64' ? 'linux64' : 'linux64-aarch64';
    return { url: download(os), archive: 'tar.xz', executable: 'firefox/firefox' };
  }
  // One universal image serves Intel and Apple silicon.
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return {
      url: download('osx'),
      archive: 'dmg',
      executable: 'Firefox.app/Contents/MacOS/firefox',
    };
  }
  // The installer unpacks without installing when given /ExtractDir, into a `core` folder.
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    const os = arch === 'x64' ? 'win64' : 'win64-aarch64';
    return { url: download(os), archive: 'exe', executable: 'firefox/core/firefox.exe' };
  }
  throw new Error(
    `no Firefox download for ${platform} on ${arch}: install Firefox and set E2E_FIREFOX to its executable`,
  );
}
