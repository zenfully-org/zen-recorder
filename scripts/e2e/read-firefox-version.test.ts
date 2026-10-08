// @vitest-environment node
import { readFirefoxVersion } from './read-firefox-version';

describe('readFirefoxVersion', () => {
  it.each([
    [
      'Linux',
      'https://download-installer.cdn.mozilla.net/pub/firefox/releases/157.0.1/linux-x86_64/en-US/firefox-157.0.1.tar.xz',
      '157.0.1',
    ],
    [
      'macOS',
      'https://download-installer.cdn.mozilla.net/pub/firefox/releases/157.0/mac/en-US/Firefox%20157.0.dmg',
      '157.0',
    ],
    [
      'Windows',
      'https://download-installer.cdn.mozilla.net/pub/firefox/releases/158.0b3/win64/en-US/Firefox%20Setup%20158.0b3.exe',
      '158.0b3',
    ],
  ])("reads the version from the address of Mozilla's %s download", (_, location, version) => {
    expect(readFirefoxVersion(location)).toBe(version);
  });

  it('refuses an address that names no release', () => {
    expect(() => readFirefoxVersion('https://www.mozilla.org/firefox/new/')).toThrow(
      'no Firefox release in https://www.mozilla.org/firefox/new/',
    );
  });
});
