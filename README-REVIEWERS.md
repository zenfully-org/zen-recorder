# Building Zen Recorder from its sources

For addons.mozilla.org's reviewers, and for anyone who wants to check that a release was built
from this code. The build is reproducible: run the two commands below and the result equals the
submitted XPI, file for file.

## What you need

- **Linux, macOS or WSL2.** Checked on Ubuntu 24.04, on x86-64 and on ARM64.
- **Node.js 24** with the npm and corepack it ships: https://nodejs.org/en/download. Node 22.14
  or later builds the same files. Node 25 and later no longer ship corepack: install it with
  `npm install --global corepack`.
- **Internet access** while installing: corepack downloads pnpm, and pnpm downloads the packages,
  both from the npm registry.

Nothing else: no global packages, no other tools.

## Build

In the folder the sources zip was unpacked into:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

- `corepack pnpm` runs the pnpm version that `packageManager` in `package.json` names, pnpm
  11.25.0, after checking its signature. corepack may ask before it downloads it.
  `npm install --global corepack@latest` fixes a "Cannot find matching keyid" error, which an
  older corepack gives.
- `--frozen-lockfile` installs exactly the versions in `pnpm-lock.yaml` and fails if it would
  change. One install script runs, esbuild's, which puts its own binary in place
  (`pnpm-workspace.yaml` allows it; puppeteer's browser download, used only by the tests, is
  turned off there). The install then runs `wxt prepare`, which writes TypeScript types.
- `pnpm build` runs `wxt build -b firefox --mv3`. The extension is in `.output/firefox-mv3`.

## Compare with the XPI

```sh
mkdir xpi && unzip -q <the XPI> -d xpi
diff -r --exclude=META-INF xpi .output/firefox-mv3
```

`diff` prints nothing when they are the same. `META-INF/` holds Mozilla's signature and is only in
a signed XPI.

A version signed on the unlisted channel, for GitHub Releases, is the self-distributed build,
which also names its update manifest. Build it with
`ZEN_RECORDER_CHANNEL=self corepack pnpm build`: the variable adds
`browser_specific_settings.gecko.update_url` to `manifest.json` and changes nothing else. A
listed version is the build of the two commands above, and so is the XPI its GitHub Release
offers.

## What the build does

- [WXT](https://wxt.dev) 0.21, on Vite 8 and Rolldown, bundles and minifies the TypeScript and
  React code of `src/` into the background script, six content scripts, the popup and the Options
  page. `wxt.config.ts` writes the manifest.
- Tailwind CSS 4 writes the stylesheet of the popup and the Options page from
  `src/styles/globals.css` and the class names in `src/entrypoints/` and `src/components/`.
- `@wxt-dev/auto-icons` renders `src/assets/icon.svg` into the PNG icons.
- At the end, `scripts/notices/` writes `LICENSE` and `THIRD-PARTY-NOTICES.md`, which lists every
  library the extension bundles with its version and licence text. The build fails on a library
  under a licence the project may not ship.

Every library comes from npm at the version in `pnpm-lock.yaml`; none is copied into the sources.
The extension loads no remote code and makes no network requests of its own.
`docs/store/permissions.md` says what each permission is for.

## What Mozilla's linter reports

`web-ext lint`, which runs the same linter as addons.mozilla.org, finds no errors and 11
warnings. Each one is expected:

- `DANGEROUS_EVAL`, 7 times: the six content scripts and the chunk the background page, the popup
  and the Options page share (`chunks/_virtual_wxt-plugins-*.js`). They are the two places where
  the schema library zod 4 uses `new Function`: a one-time probe `new Function("")` inside
  `try`/`catch` (`allowsEval` in `zod/v4/core/util.js`), which decides whether zod may compile
  faster parsers for its object schemas, and the compiler of those parsers (`$ZodObjectJIT` and
  `Doc.compile` in `zod/v4/core`). Neither runs: every entrypoint first imports
  `src/wiring/configure-zod.ts`, which sets `z.config({ jitless: true })` before any schema is
  built, so zod parses with its interpreter everywhere. The code is still in zod's files, which is
  what the linter finds. Nothing received from a page, a message or the network is ever evaluated.
- `UNSAFE_VAR_ASSIGNMENT`, 2 times, in `chunks/createLucideIcon-*.js`: React DOM's own code for
  `dangerouslySetInnerHTML` and for creating a `<script>` element. The extension uses neither and
  never sets HTML from data.
- `MANIFEST_FIELD_PRIVILEGEDONLY`: `granted_host_permissions` only applies to a temporary install
  (`about:debugging`, the project's end-to-end tests). Firefox ignores it for an installed add-on.
- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: `data_collection_permissions` needs Firefox
  for Android 142. The extension is for the desktop and is not offered for Android.

## What the sources zip holds

Every file of the repository, except tests (`*.test.ts`) and hidden files such as `.github/`.
Nothing the build reads is missing: the project's own continuous integration rebuilds every
change from its sources zip and compares the result with the XPI the same way
(`scripts/release/check-reproducible-build.sh`).

The full repository, with the tests and the history, is at
https://github.com/zenfully-org/zen-recorder.
