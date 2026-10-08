// @vitest-environment node
import { firefoxForPlatform } from './firefox-for-platform';

const download = (os: string) =>
  `https://download.mozilla.org/?product=firefox-latest-ssl&os=${os}&lang=en-US`;

describe('firefoxForPlatform', () => {
  it.each([
    {
      name: 'Linux x86-64: the linux64 tarball',
      platform: 'linux',
      arch: 'x64',
      expected: { url: download('linux64'), archive: 'tar.xz', executable: 'firefox/firefox' },
    },
    {
      name: 'Linux ARM: the aarch64 tarball',
      platform: 'linux',
      arch: 'arm64',
      expected: {
        url: download('linux64-aarch64'),
        archive: 'tar.xz',
        executable: 'firefox/firefox',
      },
    },
    {
      name: 'macOS Intel: the universal disk image',
      platform: 'darwin',
      arch: 'x64',
      expected: {
        url: download('osx'),
        archive: 'dmg',
        executable: 'Firefox.app/Contents/MacOS/firefox',
      },
    },
    {
      name: 'macOS Apple silicon: the same image',
      platform: 'darwin',
      arch: 'arm64',
      expected: {
        url: download('osx'),
        archive: 'dmg',
        executable: 'Firefox.app/Contents/MacOS/firefox',
      },
    },
    {
      name: 'Windows x86-64: the win64 installer',
      platform: 'win32',
      arch: 'x64',
      expected: { url: download('win64'), archive: 'exe', executable: 'firefox/core/firefox.exe' },
    },
    {
      name: 'Windows ARM: the aarch64 installer',
      platform: 'win32',
      arch: 'arm64',
      expected: {
        url: download('win64-aarch64'),
        archive: 'exe',
        executable: 'firefox/core/firefox.exe',
      },
    },
  ] satisfies {
    name: string;
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    expected: ReturnType<typeof firefoxForPlatform>;
  }[])('$name', ({ platform, arch, expected }) => {
    expect(firefoxForPlatform(platform, arch)).toEqual(expected);
  });

  it.each([
    { name: 'FreeBSD', platform: 'freebsd', arch: 'x64' },
    { name: '32-bit Linux', platform: 'linux', arch: 'ia32' },
  ] satisfies { name: string; platform: NodeJS.Platform; arch: NodeJS.Architecture }[])(
    'has no download for $name and says to point E2E_FIREFOX at an installed Firefox',
    ({ platform, arch }) => {
      expect(() => firefoxForPlatform(platform, arch)).toThrow(
        `no Firefox download for ${platform} on ${arch}: install Firefox and set E2E_FIREFOX to its executable`,
      );
    },
  );
});
