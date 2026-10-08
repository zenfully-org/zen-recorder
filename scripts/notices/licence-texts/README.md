# Licence texts the npm packages leave out

The extension ships `THIRD-PARTY-NOTICES.md` with the licence text of every package it bundles
(`scripts/notices/write-licence-notices.ts`, run at the end of every build). Most packages publish
their `LICENSE` on npm. The ones below do not, so the project keeps a copy of the licence file from
their source repository, laid out like `node_modules`: `<package name>/LICENSE`. A package's own
licence file always wins over the copy here.

When the build fails with "publishes no licence file", take the licence file from the package's
repository, at the tag of the bundled version where there is one, save it here unchanged under the
package's name, and add a row below.

| Package | Copied from |
| --- | --- |
| `@webext-core/isolated-element` | https://github.com/aklinker1/webext-core/blob/isolated-element-v3.0.0/LICENSE |
| `@webext-core/messaging` | https://github.com/aklinker1/webext-core/blob/messaging-v4.0.0/LICENSE |
| `@wxt-dev/browser` | https://github.com/wxt-dev/wxt/blob/wxt-v0.21.4/LICENSE (the repository's licence; the package has no tag of its own) |
| `@wxt-dev/storage` | https://github.com/wxt-dev/wxt/blob/storage-v1.2.9/LICENSE |
| `react-remove-scroll-bar` | https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE (added after 2.3.8 was published, which `package.json` already declared MIT) |
| `wxt` | https://github.com/wxt-dev/wxt/blob/wxt-v0.21.4/LICENSE |
