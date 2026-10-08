/**
 * The Firefox version in the address Mozilla's download link leads to, like
 * `…/pub/firefox/releases/157.0.1/linux-x86_64/en-US/firefox-157.0.1.tar.xz`: what
 * `pnpm setup:firefox` downloads, and what CI keys its copy of Firefox by.
 */
export function readFirefoxVersion(location: string): string {
  const version = /\/pub\/firefox\/releases\/([^/]+)\//.exec(location)?.[1];
  if (version === undefined) throw new Error(`no Firefox release in ${location}`);
  return version;
}
