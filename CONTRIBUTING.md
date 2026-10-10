# Contributing to Zen Recorder

Zen Recorder is a local meeting recorder for Firefox-based browsers. Each meeting becomes files on
the user's own disk, made to be the best input for an AI assistant, and nothing leaves the machine.
The [README](README.md) says what it does for users and how it works, and the
[user guide](docs/user-guide.md) says it in depth; this file is for people who change it.

Every change is judged by what the project is for:

- **Never lose a meeting.** A recording ends as a complete, playable file, whatever happens to the
  tab, the extension or the browser.
- **Local first.** No servers, no accounts, no uploads, no telemetry.
- **The output is an interface.** Other tools and assistants parse what a saved file says, so its
  format is documented and versioned, and its times line up with the media.

Two more pages go with this one: [docs/development-rules.md](docs/development-rules.md) explains
the rules below, and [docs/architecture.md](docs/architecture.md) shows how the code fits together.
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a security problem
privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.

## The rules

Each rule is explained, with its reasons, in [docs/development-rules.md](docs/development-rules.md).

| Rule | Checked by |
| --- | --- |
| [Write the failing test first](docs/development-rules.md#write-the-failing-test-first), at the lowest level that shows the problem | review |
| [Cover all of `src/lib`](docs/development-rules.md#cover-all-of-srclib): 100 % of statements, branches, functions and lines | `pnpm test:coverage` |
| [One exported function per file](docs/development-rules.md#one-exported-function-per-file-no-classes), with a test file of the same name, and no classes | `pnpm check:conventions` |
| [Inject browser APIs as `deps`](docs/development-rules.md#inject-browser-apis-as-deps) | review |
| [Parse every untyped input with zod](docs/development-rules.md#parse-every-untyped-input-with-zod) | review |
| [Leave nothing on the meeting page's window](docs/development-rules.md#leave-nothing-on-the-meeting-pages-window): the recorder keeps its state in closures, zod its settings in the bundle | `pnpm build`, review |
| [Never force a type](docs/development-rules.md#never-force-a-type): no `as X`, `!`, `any` or `@ts-ignore` | `pnpm check:conventions`, `pnpm compile` |
| [Target Firefox only](docs/development-rules.md#target-firefox-only), version 140 or later | review |
| [Keep each meeting service in its own folder](docs/development-rules.md#keep-each-service-in-its-own-folder) | review |
| [Write comments a stranger can follow](docs/development-rules.md#write-comments-a-stranger-can-follow) | review |
| [Bundle only libraries under a permissive licence or MPL-2.0](docs/development-rules.md#bundle-only-libraries-under-a-permissive-licence-or-mpl-20) | `pnpm build` |
| [Keep the build reproducible from its sources](docs/development-rules.md#keep-the-build-reproducible-from-its-sources) | CI's **Reproducible build** job |
| [Keep the test build's code out of a release build](docs/development-rules.md#keep-the-test-builds-code-out-of-a-release-build): probes and faults only behind `import.meta.env.WXT_E2E === '1'` | `pnpm build` |
| [Keep functions small, files short and blocks unrepeated](docs/development-rules.md#keep-functions-small-files-short-and-blocks-unrepeated): complexity, size and duplication thresholds, with a baseline of known offenders that may only shrink | `pnpm check:quality` |
| [Import in one direction](docs/development-rules.md#import-in-one-direction): no circular imports | `pnpm check:quality` |
| [Leave nothing unused](docs/development-rules.md#leave-nothing-unused): no unused file, export, type or dependency, with a baseline of the known ones | `pnpm check:quality` |
| [Avoid SonarQube's code smells](docs/development-rules.md#avoid-sonarqubes-code-smells): its recommended code-smell and security-hotspot rules, with a baseline of the known ones | `pnpm check:quality` |
| [Prove the change](#before-and-after-evidence) | review of the pull request |

`pnpm check` runs `pnpm check:lint` (Biome, lint and format, with `pnpm check:conventions`) and
`pnpm check:quality` together.

## Before and after evidence

Every pull request proves what it changed. Run the same check on the old code and on the new, and
put both in the pull request under **Before / After**:

- **A bug fix:** the reproduction failing before and passing after. That is the output of the
  failing test, plus the real symptom wherever it can be shown: the saved file (its `ffprobe`
  output, duration, audio levels, frame count), lines from the popup's Diagnostics log, console
  errors, a screenshot or a screencast.
- **A feature:** the behaviour missing before and present after: an output file, a screenshot, a
  log.

Capture the "before" first, while the old code is still in place. Paste text inline, in a
collapsed `<details>` block when it is long. Upload images and videos to the pull request (drag
them into the description on GitHub), and never commit them. A reviewer must be able to tell from
the evidence alone that the change works.

## Definition of done

A change is done when:

- [ ] the gate is green on your machine (`pnpm check`, `pnpm compile`, `pnpm test:coverage`), and
  every CI check is green on the pull request: **Gate**, **Reproducible build**, **E2E (meet)**,
  **E2E (zoom)** and **E2E (teams)** ([when one fails](#when-ci-fails));
- [ ] `pnpm test:e2e` is green on your machine, when the change touches recording, storage,
  messaging, saving the file or the entrypoints. CI runs it too, but a run of your own shows a
  failure sooner. A bug fix adds the scenario that would have caught it, where one can;
- [ ] you tried it in a browser: a development build ([below](#load-a-development-build)) on the
  [fake meeting pages](#the-fake-meeting-pages), or on the real service when the change concerns
  how a service's page or media is read;
- [ ] the pull request has its [Before / After evidence](#before-and-after-evidence);
- [ ] the docs match the code: `README.md` and [docs/user-guide.md](docs/user-guide.md) for what
  users see, an entry in `changes/` for what changed for the person recording,
  [docs/architecture.md](docs/architecture.md) when modules or the data flow change, and
  [docs/development-rules.md](docs/development-rules.md) when a rule changes;
- [ ] the pull request explains each design decision: what you chose, why, and what you rejected.

## Set up

### What you need

| Tool | Version | For |
| --- | --- | --- |
| Node.js | 22.14 or later (CI uses 24, which `.nvmrc` names) | everything |
| pnpm | the version in `package.json`, through corepack | everything |
| git | any recent | everything |
| ffmpeg and ffprobe | any recent, with libopus and libvpx (distribution builds have both), on the `PATH` | the end-to-end run reads the saved files with them, and first writes a small WebM to check its audio measures |
| Firefox | the one `pnpm setup:firefox` downloads, or yours through `E2E_FIREFOX` | the end-to-end run and the benchmarks |
| A Firefox-based browser | 140 or later | trying a development build by hand |

Corepack ships with Node.js. The corepack of Node 22.13 and older cannot check the signature of
current pnpm releases and stops with "Cannot find matching keyid"; update Node, or run
`npm install --global corepack@latest`.

### Steps

```bash
git clone https://github.com/zenfully-org/zen-recorder.git
cd zen-recorder
corepack enable          # once per Node.js install: makes `pnpm` the version package.json names
pnpm install
pnpm setup:firefox       # a Firefox for the end-to-end run, in .tools/ (nothing system-wide)
pnpm build               # the extension, in .output/firefox-mv3
```

`pnpm setup:firefox --help` shows where the browser lands on each system. When it is already
there, the command only prints its version; delete its folder under `.tools/` to get a newer one.
`pnpm --silent setup:firefox --latest-version` prints the version a download would get now, and
downloads nothing.

### Linux

Everything works as is. Install ffmpeg from your distribution (`sudo apt install ffmpeg` on Debian
and Ubuntu). `pnpm setup:firefox` downloads the release tarball (x86-64 or ARM) and needs `tar`
with xz support, which most distributions have.

If the end-to-end run stops with "the browser cannot play audio", Firefox found no audio output.
That happens mostly under WSL2. `scripts/test-audio.sh` runs a private PulseAudio server with a
silent output for the test browsers, without root:

```bash
scripts/test-audio.sh setup    # once: unpacks PulseAudio into .tools/pulse (Debian and Ubuntu: apt-get download)
scripts/test-audio.sh start    # the end-to-end run uses it by itself while it runs
```

### macOS

Install ffmpeg (`brew install ffmpeg`). `pnpm setup:firefox` downloads the disk image and copies
`Firefox.app` into `.tools/`. If that fails, install Firefox as usual and point the end-to-end run
at it:

```bash
export E2E_FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox
```

A desktop Firefox has audio, so `scripts/test-audio.sh` is not needed. Two things work on Linux
only: that script, and the CPU figures of `pnpm bench` (it reads them from `/proc`).

### Windows

Use WSL2 with Ubuntu and follow the Linux steps inside it: that is how the project is developed.
Its test browser runs headless; to watch it (`E2E_HEADLESS=0`) you need WSLg, which current
versions of WSL include.
To try a build in a browser installed on Windows, see
[WSL2 and Zen on Windows](#wsl2-and-zen-on-windows-optional).

On Windows itself (PowerShell or cmd), the scripts a contributor runs work: CI's "Windows
(install, check, test)" job runs `pnpm install`, `pnpm check`, `pnpm compile`, `pnpm test`,
`pnpm build` and `pnpm build:e2e` on every pull request (it is not a required check yet). The
repository's `.gitattributes` keeps LF line endings in the working copy, so Git for Windows'
default conversion to CRLF does not reach it. What needs more:

- The tests of the project's shell scripts run them with `bash`: put Git Bash on the `PATH`, as
  Git for Windows' "Use Git and optional Unix tools from the Command Prompt" does and GitHub's
  Windows runners have. The release scripts' tests also need `zip` and `unzip` and are skipped on
  Windows; those scripts run on Ubuntu, in CI and in the release.
- `pnpm check:identity` is a bash script too, and it is the maintainer's: it reads patterns no clone
  has.
- The end-to-end run and `pnpm bench` have not been run on Windows. `pnpm setup:firefox` runs and
  unpacks Firefox into `.tools\firefox\core\firefox.exe`, but nothing more is known.
- `scripts/test-audio.sh` is for Linux and WSL2 only; a desktop Firefox has audio.

## Run

### The gate

These are the commands CI runs on every pull request and on every push to `main`
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
pnpm install --frozen-lockfile
pnpm check:lint       # Biome and the project's conventions (pnpm check:fix formats and fixes)
pnpm check:quality    # complexity, size, code smells, unused code and duplicated blocks against their baselines, circular imports
                      # (CI runs it as pnpm quality:report, which also writes the report below)
pnpm compile          # TypeScript, strict, no output (CI runs pnpm exec tsc --noEmit)
pnpm test:coverage    # unit tests, with 100 % coverage of src/lib
pnpm build            # the extension, in .output/firefox-mv3, and the licence check
```

After a change to the meeting notes format (`src/lib/notes/parse-meeting-notes.ts`),
`pnpm notes:schema` writes its JSON Schema again, `docs/meeting-notes.schema.json`; a test fails
until it does.

`pnpm check` runs the first two together. `pnpm check:quality` prints one line when the code is
within the thresholds of `eslint.config.js` and `.jscpd.json` or in the baselines
(`quality-baseline.json`, `.jscpd-baseline.json`), and otherwise one line per failure: the file
and line, the function, the metric with its value and threshold, and what to do. "New offender"
and "got worse" ask for a change to the code. A value the code has beaten does not fail: under
"Could be lowered" the check lists each entry that is "improved", "gone" or a "stale entry" (in CI
also in one notice on the run), and your pull request may leave it there. `pnpm check:quality
--update-baseline` rewrites both baseline files from the current code (review the diff: it should
only remove entries or lower values); see "Lowering the baselines" below. An inline `// eslint-disable` comment changes nothing: ESLint ignores it, the
finding is still reported, and the comment fails on its own (`no-inline-config`) until it is
removed. ESLint keeps a cache in `node_modules/.cache/zen-recorder/eslint/`, so a run lints again
only the files whose contents changed (about 4 s instead of 9 s for `pnpm check:quality` when
little changed). A file's cached results, findings included, are dropped when its contents, the
configuration in `eslint.config.js`, ESLint, Node.js or `pnpm-lock.yaml` change; delete that
folder to start from nothing. CI starts without a cache. [The rule](docs/development-rules.md#keep-functions-small-files-short-and-blocks-unrepeated)
lists the thresholds. A circular import fails too, printed as the chain of files that import each
other; it has no baseline, as the code has none
([the rule](docs/development-rules.md#import-in-one-direction)). dependency-cruiser finds them with
the rules of `.dependency-cruiser.cjs`.

The same check runs knip (`knip.jsonc`), which finds unused files, exports, types and
dependencies, imports it cannot resolve and binaries `package.json` does not list. Each finding is
a line like `src/lib/page/reduce-lifecycle.ts:290  throwawayHelper  unused-export  new offender`:
use the export, remove it, or drop the `export` keyword when only its own file uses it. The ones
the code already had are listed in `quality-baseline.json` under their file and name (an exported
type, for instance, stays until its own change decides whether it is public). Fixing one turns its
entry into a "stale entry", which `pnpm check:quality --update-baseline` removes. A file,
dependency or binary that is used in a way knip cannot see (a script started by its path, a
system tool) goes into `knip.jsonc`, with the reason
([the rule](docs/development-rules.md#leave-nothing-unused)).

It also runs SonarQube's recommended code-smell and security-hotspot rules (`eslint-plugin-sonarjs`
in `eslint.config.js`). A finding names the rule, like
`src/lib/page/reduce-lifecycle.ts:291  throwawayLabel  no-nested-conditional  new offender`; its
page on [rules.sonarsource.com](https://rules.sonarsource.com/javascript/) says what it asks for
and how to rewrite the code. The ones the code already had are in `quality-baseline.json` with the
metrics, and the same "stale entry" and `--update-baseline` apply
([the rule](docs/development-rules.md#avoid-sonarqubes-code-smells)).

**Lowering the baselines.** A pull request may leave a value better than its baseline: the check passes and lists it, so two
pull requests that improve the same function do not both edit its line of
`quality-baseline.json` and conflict there. The baselines are lowered separately. The scheduled
**Tight baselines** check (`.github/workflows/quality-baseline.yml`, on Mondays, or by hand from
the Actions tab) runs `pnpm check:quality --strict`, which fails on that slack too, and its report
lists every entry. While it is red, a small pull request with `pnpm check:quality --update-baseline`
lowers them, and every release pull request does the same. The price is that between two such
pull requests, a function can grow back up to its old value without failing the check.

The gate prints only what fails, and the slack. For the whole picture, `pnpm quality:report` runs the same gate
and writes `.quality/report.html` and `.quality/report.json` (git ignores the folder), pass or
fail, in about the time the gate takes. The HTML page opens from disk with no network and shows
every file and function with its numbers against its thresholds, how each metric spreads (median,
90th percentile, largest), the 20 largest values per metric, every baseline entry with today's
value, the clones and the import rules; a click on a column's header sorts by it. The JSON holds
the same data for other tools; its shape is versioned (`"version": 1`) and described at the top of
the HTML page. CI runs `pnpm quality:report` and attaches `.quality/` to every run, failed ones
too, as the artifact `quality-report`: open the run from the pull request's checks, and it is
listed under **Artifacts** at the bottom of the run's summary page, kept for 14 days.

`pnpm build` fails when the extension would bundle a package under a licence the project may not
ship, and otherwise writes `LICENSE` and `THIRD-PARTY-NOTICES.md` into it
([the rule](docs/development-rules.md#bundle-only-libraries-under-a-permissive-licence-or-mpl-20)).
CI runs them in its **Gate** job, with the Node.js of `.nvmrc` (24) and the pnpm version from
`packageManager`. The first command that fails stops the job, and the job's report names it
([When CI fails](#when-ci-fails)). A second job, **Reproducible build**, runs `pnpm zip`, rebuilds
the extension from the sources zip in an empty folder and compares it with the XPI
([the rule](docs/development-rules.md#keep-the-build-reproducible-from-its-sources)). Three more,
**E2E (meet)**, **E2E (zoom)** and **E2E (teams)**, run [the end-to-end run](#the-end-to-end-run),
one service each. **Windows (install, check, test)** runs the gate's commands and both builds on
Windows itself ([Windows](#windows)); it is not a required check yet.
`pnpm test` runs the unit tests without coverage, and `pnpm test:watch` keeps running them while
you edit.

Files git ignores stay out of the checks, the tests and the sources zip. Biome skips what git
ignores, `.git/info/exclude` included. `pnpm check:quality` and `pnpm check:conventions` read the
files git lists: the tracked ones and the new ones no ignore rule covers, so a module you have not
staged yet is checked, and its test must be one of them too. jscpd and knip read git's ignore files.
`pnpm test` runs no test, and counts no coverage, in a file git ignores. `tsc` reads only the folders
`tsconfig.json` lists (`src/lib`, `scripts` and the like), and `pnpm check:conventions` fails when
a tracked TypeScript file sits outside them. The sources zip that `pnpm zip` writes for review on addons.mozilla.org
holds only the files git tracks, so stage a new file before zipping. A scratch folder of your own,
say `src/scratch/` listed in `.git/info/exclude`, reaches none of them.

### The end-to-end run

CI runs it on every pull request and every push to `main`, one job per service. Run it yourself
too when a change touches recording, storage, messaging, saving the file or the entrypoints:

```bash
pnpm test:e2e
```

It builds the test flavour of the extension (`pnpm build:e2e`, which adds the debug probes and
faults the run drives; a release build leaves them out, and fails when it would ship one), starts Firefox through Puppeteer, and runs every scenario of
`scripts/e2e/scenarios.ts` on each service's fake page. Saved files land in `.e2e/downloads/`.
A full run takes several minutes. These variables narrow or change it:

| Variable | Effect |
| --- | --- |
| `E2E_PROVIDERS=meet,zoom` | only these services (`meet`, `zoom`, `teams`) |
| `E2E_SCENARIOS=routing,3,14` | only these scenarios, by the names `scripts/e2e-fixture.ts` lists or a scenario file registers |
| `E2E_HEADLESS=0` | show the browser |
| `E2E_KEEP_OPEN=1` | leave the browser open at the end |
| `E2E_FIREFOX=<path>` | use this Firefox instead of the one in `.tools/` |
| `E2E_UPGRADE_FROM=<commit or tag>` | the build scenario 88 updates from, instead of the previous release |

Scenario 88 updates the add-on mid-recording from the previous release: the newest `v*` tag, or
the first public commit while no release is tagged. It builds that commit's test flavour in a
temporary git worktree (`pnpm install` and `pnpm build:e2e` there) and keeps the build in
`node_modules/.cache/zen-recorder/upgrade-from/`. The first run needs `git` to reach `origin` and
takes a minute or two longer.

When a service's run fails, it prints one line that names the service, the scenario (by its name
and its function) and the check that failed, for example
`✘ meet: scenario 35 (scenarioFirstSecondsHaveAudio) failed: timeout waiting for saved file`,
then the whole error. It saves the extension's Diagnostics log to `.e2e/diagnostics-<service>.json`.
The other services still run.

Run one browser test at a time. Several Firefox processes started by tests on one machine disturb
each other's timing, and scenarios that check frame rates or durations then fail. If you keep
several working copies side by side, share a lock file between them:
`flock ../.browser.lock pnpm test:e2e` (`flock` is part of util-linux on Linux).

### Adding an end-to-end scenario

A new scenario goes in a file of its own, `scripts/e2e/scenario-<what-it-guards>.ts`, whose
header says what it guards and why. The file registers the scenario itself, so it edits no list
that other pull requests edit too:

```ts
export async function scenarioSomethingSaved({ browser, target }: ScenarioContext): Promise<void> {
  // …
}

export const registration = {
  name: 'something-saved', // what E2E_SCENARIOS selects, and what a failure names
  after: '84', // the scenario it runs right after
  scenario: scenarioSomethingSaved,
} satisfies ScenarioRegistration;
```

`ScenarioContext` comes from `./scenarios` and `ScenarioRegistration` from `./order-scenarios`.
The run finds every `scenario-*.ts` that exports `registration` and runs it right after the
scenario `after` names: one in the list of `scripts/e2e-fixture.ts`, or another registered one.
Several that name the same scenario run in the order of their names, numbers by value. Pick
`after` for what the scenario needs: the last scenarios reload the extension, so a scenario that
needs a clean one runs before them. The run stops before the first scenario when a name is taken
or `after` names no scenario of the run. The older scenarios are still rows of `SCENARIOS` in
`scripts/e2e-fixture.ts`; leave that list alone.

A fixture call only your scenario needs goes in your scenario file, which adds it to `FixtureApi`:

```ts
declare module './harness' {
  interface FixtureApi {
    /** What it does on the fake page. */
    dropSlot?(): void;
  }
}
```

A call several scenarios share goes in `FixtureApi` in `scripts/e2e/harness.ts`, next to the
members of its area, never as the last member. Implement it in each fake page
(`src/test/fixtures/fake-<service>.html`) next to the related member of `window.__fixture` too,
not at the end: two pull requests that both append there conflict.

### A long recording (soak)

```bash
pnpm soak
```

It records one long take with video on each service's fake page (e2e scenario 92), 10 minutes by
default. Set `SOAK_MINUTES=30` for a longer one, and `E2E_PROVIDERS` to narrow the services.

Every minute it reads the memory of the meeting page's process and of the extension's, the
recorder's frame statistics, the chunks the page holds and the storage the extension uses. At the
end it checks the saved file:
- as long as the recording, and not "(recovered)";
- audio and video ending within 1.25 s of each other (a picture that stops changing is drawn once a
  second, so the video may end up to a second early without any drift);
- in every minute, at least 60 % of the frame rate the recorder aimed for, unless its own statistics say the machine was too busy;
- one chunk every 3 s;
- the page's memory not growing by half;
- none of its chunks left in the store once the file is saved.

It writes what it measured to `.e2e/soak-<service>.json`. `pnpm test:e2e` never runs it.

The **Soak** workflow (`.github/workflows/soak.yml`) records 120 minutes on each service every
Saturday, a file of about 1 GB. It also runs by hand from the Actions tab (Run workflow: the
minutes, and one service or all), but never on a pull request or in the merge queue.

### The fake meeting pages

`pnpm fixture` serves one fake page per service on port 4173. Each one mimics that service's page
and media path, with a remote participant who plays a 440 Hz tone and moving video:

- Google Meet: `http://localhost:4173/abc-defg-hij`
- Zoom: `http://localhost:4173/zoom/wc/1234567890/join`
- Microsoft Teams:
  `http://localhost:4173/teams/light-meetings/launch?anon=true&coords=eyJjb252ZXJzYXRpb25JZCI6IjE5Om1lZXRpbmdfWm1sNGRIVnlaUzFqWVd4c0B0aHJlYWQudjIiLCJ0ZW5hbnRJZCI6IjExMTExMTExLTIyMjItNDMzMy04NDQ0LTU1NTU1NTU1NTU1NSJ9`

Load a development build, open a page and click its join button (**Join call**, **Join**,
**Join now**); the recorder treats the page like the real service. The end-to-end run serves the same pages on its own port (4175).

Each page also comes with a report-only Content Security Policy that forbids `eval` and requires
Trusted Types. It blocks nothing; `http://localhost:4173/csp-reports` lists what it would have
reported to a service with that policy.

### The benchmarks

- `pnpm bench` records on every service's fake page with a 1080p screen share and measures, with
  the tab in front and hidden, the frame rate in the saved file, the recorder's own timings, the
  page's event-loop lag and the CPU per browser process. Results go to `.e2e/bench/*.json`.
  `BENCH_PROVIDERS`, `BENCH_PROFILES`, `BENCH_SECONDS` and `BENCH_LABEL` change what it runs;
  `E2E_EXTENSION_DIR=<another build>/firefox-mv3` measures another build on the same pages.
- `pnpm bench:primitives` runs `scripts/bench/zen-perf.html`, which times single browser operations
  (drawing a video, `new VideoFrame`, each encoder). The same file opens from disk in any
  Firefox-based browser.

Close every other Firefox while timing, and hold the same lock as the end-to-end run.

### Load a development build

1. `pnpm build`, or `pnpm dev` to rebuild on every change (it does not launch a browser).
2. In Firefox or Zen: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
   `.output/firefox-mv3/manifest.json` in the working copy (from WSL2, see
   [WSL2 and Zen on Windows](#wsl2-and-zen-on-windows-optional)).
3. Join a call on any supported service. The status card appears on the right edge of the page; the toolbar icon shows **REC**.

Temporary add-ons get the host permissions of every service automatically (`granted_host_permissions`).

### Install an unsigned build permanently

Release Firefox refuses an unsigned add-on. Zen, LibreWolf and Floorp are built without mandatory
add-on signing, so an unsigned XPI installs there after one pref change:

1. `about:config` → `xpinstall.signatures.required` = `false` (check `about:support` → "Add-on signing").
2. `pnpm zip` → rename `.output/zen-recorder-<version>-firefox.zip` to `.xpi` (from WSL2, see
   [WSL2 and Zen on Windows](#wsl2-and-zen-on-windows-optional)) → `about:addons` → gear →
   **Install Add-on From File…**, or drag the XPI onto the browser window.
3. On the install prompt accept the site permissions (Meet, Zoom, Teams). If you skipped one, or
   updated from a version that did not have it, the popup shows a **Grant access** button.

To sign a build yourself, use AMO's unlisted channel:
`pnpm exec web-ext sign --source-dir .output/firefox-mv3 --channel unlisted --api-key … --api-secret …`.

### WSL2 and Zen on Windows (optional)

Only when the working copy lives in WSL2 and the browser you try builds in runs on Windows.
`<you>` is the Windows user name, `<distro>` the WSL distribution and `<working copy>` the working
copy's Linux path written with backslashes.

- Load the temporary add-on over the WSL share:
  `\\wsl.localhost\<distro>\<working copy>\.output\firefox-mv3\manifest.json`.
- `pnpm open:build` opens `.output/firefox-mv3` in Windows Explorer, from WSL2 as from Windows
  itself. Anywhere else it only says so.
- Explorer hides the `.output` dot-folder on the WSL share, so copy the XPI to Windows first:
  `cp .output/zen-recorder-<version>-firefox.zip /mnt/c/Users/<you>/Downloads/zen-recorder-<version>.xpi`.
- The end-to-end run plays audio through WSLg's PulseAudio server, which sometimes stops answering
  ("Connection refused" from `pactl info`). Use `scripts/test-audio.sh` then (see [Linux](#linux)).

## When CI fails

Every CI job ends with a report, whether it passed or not. It names the step that failed, the
errors that matter, and the command that runs the same step on your machine. A person reads it on
GitHub; a tool reads the same as JSON.

**On GitHub.** Open the failed check from the pull request (**Details**), then the run's
**Summary**. Each job shows a table of its steps, with their result and time, and under it the
failed step: its errors and the command to run it locally. Each error is also an annotation: on
its line in the pull request's **Files changed** tab when it names one (Vitest, tsc, Biome, the
conventions check, the quality gates, coverage), and otherwise in the run's list of annotations
(a failed end-to-end check, a missed coverage threshold).

**From the command line**, with the [GitHub CLI](https://cli.github.com/):

```bash
gh pr checks <pull request>                 # which checks failed, with each run's address
gh run view <run id> --log-failed           # the whole output of the steps that failed
gh run download <run id> -n ci-report-gate  # the Gate job's report: ci-report.json and logs/
```

The run id is the number in the run's address (`…/actions/runs/<run id>`). Each job has its own
report: `ci-report-gate`, `ci-report-reproducible-build`, `ci-report-e2e-meet`,
`ci-report-e2e-zoom` and `ci-report-e2e-teams`. It holds `ci-report.json` and, under `logs/`, the
whole output of the step that failed. A failed end-to-end job also leaves `e2e-<service>`: the
recordings the run saved and the extension's Diagnostics log (the run's `.e2e/` folder). Reports
are kept 14 days, the end-to-end files 7. The Soak workflow's jobs leave `ci-report-soak-<service>`
and `soak-<service>`: what the soak measured, and the Diagnostics log when it failed, never the
recording. Both are kept 30 days.

**Run the same step yourself.** The summary's "Run it locally" block is the step's command as CI
ran it. The gate's commands need only `pnpm install`; one test file runs alone with
`pnpm exec vitest run <file>`. An end-to-end job runs `E2E_PROVIDERS=<service> pnpm test:e2e`,
which needs Firefox and an audio output ([Set up](#set-up)). `E2E_SCENARIOS=<name>` runs one
scenario alone, which is faster, but a scenario can depend on what ran before it in the same
browser, so check the whole run before you call a failure fixed.

**When there is no report.** A job that fails before its dependencies are installed cannot write
one, and `gh run view <run id> --log-failed` shows why. Most often `pnpm-lock.yaml` does not match
`package.json`: run `pnpm install` and commit the lockfile.

### The report's JSON

`ci-report.json` is an interface for tools: its shape changes only with a new `version`, and
[`scripts/ci/parse-ci-report.ts`](scripts/ci/parse-ci-report.ts) parses it. A failed end-to-end
job's report, shortened:

```json
{
  "version": 1,
  "job": "e2e-meet",
  "jobName": "E2E (meet)",
  "status": "failed",
  "run": {
    "workflow": "CI",
    "id": 37842080740,
    "attempt": 1,
    "url": "https://github.com/zenfully-org/zen-recorder/actions/runs/37842080740",
    "sha": "0b5c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c",
    "ref": "refs/pull/61/merge",
    "event": "pull_request"
  },
  "failedStep": "e2e",
  "steps": [
    {
      "id": "install",
      "command": "pnpm install --frozen-lockfile",
      "status": "passed",
      "durationSeconds": 14.2,
      "exitCode": 0,
      "log": null,
      "failures": []
    },
    {
      "id": "e2e",
      "command": "E2E_PROVIDERS=meet pnpm test:e2e",
      "status": "failed",
      "durationSeconds": 512.3,
      "exitCode": 1,
      "log": "logs/e2e.log",
      "failures": [
        {
          "tool": "e2e",
          "message": "timeout waiting for saved file",
          "file": null,
          "line": null,
          "column": null,
          "rule": null,
          "test": "scenarioFirstSecondsHaveAudio",
          "scenario": "35",
          "provider": "meet"
        }
      ]
    }
  ],
  "artifacts": ["e2e-meet"]
}
```

| Field | What it holds |
| --- | --- |
| `version` | `1` |
| `job`, `jobName` | the report's key (`gate`, `e2e-meet`) and the check's name (`Gate`, `E2E (meet)`) |
| `status` | `passed`, `failed` or `cancelled` |
| `run` | the workflow, the run's `id`, `attempt` and `url`, the commit it tested (`sha`: for a pull request, its merge with the base branch), the `ref` and the `event` |
| `failedStep` | the id of the first step that failed, or `null` |
| `steps` | every step with an id, in run order: its `id`, the `command` it ran (`null` for a step that runs an action), its `status` (`passed`, `failed`, `skipped` or `cancelled`), `durationSeconds`, `exitCode`, `log` (a failed step's output in the artifact) and its `failures` |
| `failures` | the errors of a failed step, each with the `tool` that reported it and its `message`, and as much of `file`, `line`, `column`, `rule` (the lint rule, the TypeScript error code, the quality metric or the coverage measure), `test` (a unit test's describe blocks and name, or an end-to-end scenario's function), `scenario` and `provider` (the service an end-to-end run tested) as the tool said; the rest is `null` |
| `artifacts` | the job's other artifacts that help with a failure, like `e2e-meet` |

`tool` is one of `vitest`, `coverage`, `tsc`, `biome`, `conventions`, `quality`, `e2e`,
`annotation` (an error a step wrote as a GitHub workflow command) or `log`. `log` means no tool
the report knows recognized the output, and the message is the end of the step's log.

## Issues

### How issues are triaged

Open an issue through one of the [forms](https://github.com/zenfully-org/zen-recorder/issues/new/choose):
a bug report, "a service changed its page" or a feature request. Each one asks for what triage
needs, and blank issues are off. The forms live in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).

Every form labels a new issue `needs-triage` until the maintainer has read it. Then it gets labels
for its kind and service, and the maintainer accepts it (`accepted`), asks for what is missing, or
closes it with a reason. Work on an issue starts once it is accepted. Before you start on anything
larger than a small fix, say in the issue that you are taking it, so that two people do not do the
same work.

Only people with triage rights on the repository can add or remove a label (GitHub's
[repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)),
so whoever opens an issue cannot mark it `accepted`.

| Label | Means |
| --- | --- |
| `needs-triage` | New: the maintainer has not read it yet |
| `accepted` | The maintainer accepted it: work can start |
| `needs-maintainer` | Parked: only the maintainer can decide or test this |
| `provider:meet`, `provider:zoom`, `provider:teams` | The meeting service it concerns |
| `meeting-notes` | The meeting-notes feature |
| `open-source` | Publishing the project |
| `dependencies` | A pull request that updates a dependency ([Dependency updates](#dependency-updates)) |
| `bug`, `enhancement`, `documentation`, `question`, `duplicate`, `invalid`, `wontfix`, `good first issue`, `help wanted`, `accessibility` | As on any GitHub repository |

`scripts/setup-labels.sh` creates this set on a repository, or updates the colours and
descriptions of the labels it already has; it never deletes one. It needs the GitHub CLI (`gh`),
logged in with write access: `scripts/setup-labels.sh --repo <owner>/<name>`.

### Writing a good issue

- **A bug:** the Zen Recorder version (`about:addons`), the browser and its version, the operating
  system, the meeting service, the steps, what you expected and what happened. Add the Diagnostics
  log: the popup's **Diagnostics** button copies it. Read it before you paste it: it names your
  recordings' files, and so your meeting titles. Never attach a recording or a screenshot that
  shows other people.
- **A service changed its page:** which service, since when, and what broke (no REC, no video
  tiles, no audio, a wrong title), with the Diagnostics log.
- **A feature:** the problem first, then your idea. Say who it helps and how they work around it
  today.
- **A security problem:** not an issue. See [SECURITY.md](SECURITY.md).

One issue per problem. Something you notice on the way that is not part of your issue gets its own
issue, not a detour in your pull request.

## Commits and pull requests

- One issue per pull request, on a branch named `fix/<slug>` or `feat/<slug>`.
- The commit subject is one sentence that says what changed for the person recording, and ends
  with the issue: "A Zoom host alone no longer starts recording when a guest knocks (fix #<number>)".
  The body says why.
- The pull request description says `Closes #<number>`, the root cause (for a bug), what changed,
  why this approach and what you rejected, the [Before / After evidence](#before-and-after-evidence),
  the last lines of the gate's commands, and the [definition of done](#definition-of-done) ticked
  off. The [pull request template](.github/pull_request_template.md) has a section for each.
- Credit people only: no "generated with" lines and no co-author trailers for tools.
- Pull requests are squash-merged through a merge queue. Once a pull request is reviewed and its
  checks are green, the maintainer adds it to the queue, which runs every check again on it
  together with `main` and the pull requests ahead of it, and merges it only when they all pass.
  A branch therefore does not need to be brought up to date with `main` by hand, unless it
  conflicts with it.

## Dependency updates

[Dependabot](.github/dependabot.yml) proposes them as pull requests, and CI checks them like any
other:

- **The actions the workflows use**, once a month, in one pull request. The repository requires
  every action pinned to a full commit SHA, with its version in a comment after it
  (`uses: actions/checkout@<sha>  # v7.0.1`); Dependabot moves the two together.
- **The npm packages**, every Monday: one pull request for the minor and patch updates of the
  quality tools (Biome, ESLint and its plugins, knip, jscpd, dependency-cruiser), one for what the
  extension bundles, one for the other development packages, and one for each major update. At
  most five are open at once.
- **Security updates**, as soon as an advisory names a package the project uses, directly or
  through another package: all of them in one pull request.
- Dependabot proposes no release younger than 7 days, except for a security update, so a broken or
  hijacked release has time to be noticed and withdrawn. pnpm also refuses to install any package published less than a day
  ago (`minimumReleaseAge`), the dependencies of a dependency included.

The maintainer merges an update once its checks are green and its release notes ask for nothing
more. Some updates need a change on the same branch first:

- A quality tool that measures or reports differently fails `pnpm check:quality`: run
  `pnpm check:quality --update-baseline` and let the pull request show the baselines' diff.
- A new Biome version: `pnpm exec biome migrate --write` moves `biome.json` to its schema.
- A bundled package whose licence changed fails `pnpm build`
  ([the rule](docs/development-rules.md#bundle-only-libraries-under-a-permissive-licence-or-mpl-20)):
  the update waits for a decision.
- A dependency of a dependency published less than a day before Dependabot made the update fails
  the install with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Comment `@dependabot recreate` on the
  pull request a day later. Never lower `minimumReleaseAge` or add an exception for it.

Dependabot's titles ("Bump the development group with 3 updates") stay as they are. An update
needs no issue and no changelog entry, unless it changes what the person recording notices.

## The changelog and releases

### An entry for each change people notice

A pull request that changes what the extension does adds an entry: a Markdown file of its own in
[`changes/`](changes/), in the folder of its group (`added/`, `changed/`, `removed/` or `fixed/`),
named after the issue the pull request closes (`changes/fixed/72.md`), or after the pull request
when there is no issue. Two pull requests then never edit the same lines, so neither has to wait
for the other. Write the entry as it will read in [`CHANGELOG.md`](CHANGELOG.md), without the
leading `- `: for the person recording, what they notice, not what the code does. A fix says what
went wrong before. End it with that number, `(#<number>)`. A pull request that changes two things
writes two files. Entries written before the project's public issue tracker opened name no issue.
A change nobody using the extension can notice (tests, tooling, contributor docs) needs no entry.

`pnpm changelog` prints every waiting entry as the next release's section will read: the groups in
the order above, and in each group the entries by file name, those named after a number first, by
that number.

### Making a release

The maintainer makes the releases:

1. A pull request runs `pnpm changelog --release <version>`, which writes the waiting entries into
   a new section `## <version> - <YYYY-MM-DD>` right below `## Unreleased` and deletes their files
   in `changes/`, and sets `version` in `package.json` to the same version (the manifest takes it
   from there). Versions follow
   [semantic versioning](https://semver.org/): before 1.0.0, a release with new features raises
   the minor version, one with fixes only raises the patch. It also runs
   `pnpm check:quality --update-baseline`, so every release lowers the baselines to what the code
   measures.
2. Once it is merged, the maintainer tags that commit `v<version>` and pushes the tag.
3. The tag starts the release workflow (`.github/workflows/release.yml`):
   1. It checks that the tag names `package.json`'s version, runs the gate, and builds the
      add-on for the channel addons.mozilla.org signs it on (below) with `pnpm zip`: the XPI and
      the sources zip. It then rebuilds the XPI from the sources zip, as addons.mozilla.org's
      reviewers will, and stops when the two differ.
   2. It drafts the GitHub Release of the tag. The notes are the version's section, as
      `scripts/release-notes.sh <version>` prints it, followed by the install steps and the
      independence notice of `.github/release-notes-footer.md`. The sources zip is attached.
   3. It waits for the maintainer to approve the `release` environment. Then addons.mozilla.org
      signs the XPI on the channel (`web-ext sign`, with the channel's metadata from
      `.github/amo-metadata/`), and the signed `zen-recorder-<version>.xpi` is attached.
   4. It checks the XPI attached to the release (the version, the add-on id, the update manifest
      its channel needs or forbids, Mozilla's signature), publishes the release, and publishes
      the project site with the update manifest (`scripts/release/update-pages.sh`, below).

`pnpm test` checks the changelog's shape: `## Unreleased` first, holding no entry, then one section
per release with its date, newest first, every entry in a group, the groups in order, and the
newest release equal to the version in `package.json`. It also reads every file in `changes/`: one
in another folder, an empty one, or one named after a number whose entry does not end with that
number fails. `scripts/release-notes.sh` fails on a version the
changelog has no section for, and on a section without an entry.

### The two channels, and how installed copies update

addons.mozilla.org (AMO) signs every release, on one of its two channels. The repository variable
`AMO_CHANNEL` picks it (Settings → Secrets and variables → Actions → Variables). The maintainer
sets it once:

| `AMO_CHANNEL` | When | The build | How installed copies update |
|---|---|---|---|
| `unlisted` (the default, also when unset) | before the add-on is listed on AMO | `ZEN_RECORDER_CHANNEL=self`: its manifest names the update manifest, `https://zenfully-org.github.io/zen-recorder/updates.json` | the browser checks `updates.json` once a day |
| `listed` | from the first listed release on | without `ZEN_RECORDER_CHANNEL`: its manifest names no update manifest, which AMO requires on this channel | from AMO, like any listed add-on |

AMO keeps one version number per add-on across both channels, deleted versions included, and a
listed version must be higher than the last listed one. So a version signed unlisted can never be
listed: once the add-on is to be listed, its releases go through the listed channel. With
`listed`, the GitHub Release offers the file AMO serves, and the release sends the listing's
metadata (`.github/amo-metadata/listed.json`): the summary, the categories, the licence and the
notes to reviewer of [`docs/store/listing.md`](docs/store/listing.md), which a test keeps equal.
Any other value of the variable stops the release.

`ZEN_RECORDER_CHANNEL=self` builds the self-distributed add-on. Every other build names no update
manifest: a development build, the build CI makes, and the listed one. Set the variable for
`pnpm zip` too, because `wxt zip` builds again before it zips. Any other value stops the build.

`updates.json` lives on the `gh-pages` branch, which GitHub Pages serves, next to the files of
`site/`: the install page and the privacy page. Each release adds its version, the address of its
XPI and the XPI's SHA-256 (`scripts/release/write-update-manifest.ts`), and keeps the versions
before it, so a browser too old for the newest one still finds one it can run. A listed release
gets its entry too. A copy installed from a GitHub Release before the listing updates to that
XPI, which names no update manifest, and from then on Firefox updates it from AMO. The script
refuses an XPI that is unsigned, of another version, or the wrong build for the channel, and a
published `updates.json` it cannot read.

### When signing takes longer

AMO signs most versions within minutes, and the workflow waits 30 minutes. A version picked for
a manual review can take up to a day. The run then fails after the draft, and the maintainer
finishes the release by hand:

1. Download the signed XPI from the AMO Developer Hub once it is approved.
2. Attach it to the draft: `gh release upload v<version> zen-recorder-<version>.xpi`.
3. Run the workflow on the tag (Actions → Release → Run workflow, "Use workflow from" the tag)
   with the mode `publish`, and `AMO_CHANNEL` as it was for the tag. It checks the attached XPI,
   publishes the release and the update manifest.

The same goes for both channels: a listed version held for a manual review is signed once a
reviewer approves it.

### Listing on addons.mozilla.org

The add-on is not listed on addons.mozilla.org yet. The first release with `AMO_CHANNEL` set to
`listed` creates the listing. [`docs/store/`](docs/store/) holds what the listing needs: the texts
([`listing.md`](docs/store/listing.md)), the privacy policy ([`privacy.md`](docs/store/privacy.md)),
why each permission is needed ([`permissions.md`](docs/store/permissions.md)) and the maintainer's
steps ([`submission.md`](docs/store/submission.md)). [`README-REVIEWERS.md`](README-REVIEWERS.md), at
the root of the sources zip, tells Mozilla's reviewers how to rebuild the XPI.

### Trying the release without publishing

Pull requests that change the release (the workflow, `.github/amo-metadata/`, `scripts/release/`,
`site/`, `wxt.config.ts`) run its build as a dry run, once per channel: the gate, the XPI, the
sources zip, the notes and a preview of `updates.json`, uploaded as the run's artifacts. Nothing is
signed or published. The listed build's manifest names no update manifest, the unlisted one's
does, and the release's check of each XPI says so. The same runs by hand with the mode `dry-run`,
on any branch or tag.

## Stack

WXT 0.21 (Firefox MV3) · TypeScript 6 · React 19 + Tailwind v4 + shadcn/ui · zod 4 · idb · mediabunny ·
Biome · ESLint with eslint-plugin-sonarjs, jscpd, dependency-cruiser and knip (the quality gate only) · Vitest 4 (+ fake-browser,
fake-indexeddb, happy-dom) · Puppeteer (Firefox via WebDriver BiDi).

## The project's texts

The extension's name, its manifest description and the independence notice are written once, in
`src/lib/project/get-project-texts.ts`. The manifest and the Options page read them from there, and
its test fails when `README.md` or the store texts in [`docs/store/listing.md`](docs/store/listing.md)
say something else. Change a text in the function and in those two files together.

The same goes for the store's other texts. The privacy policy is written in
[`docs/store/privacy.md`](docs/store/privacy.md) and published as `site/privacy.html`; the test
compares the two sentence by sentence. The manifest's permissions come from
`src/lib/project/get-manifest-permissions.ts`, and its test fails when
[`docs/store/permissions.md`](docs/store/permissions.md) or the notes to reviewer in the listing
do not justify exactly those.
