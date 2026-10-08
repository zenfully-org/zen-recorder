# Development rules

Zen Recorder records meetings that people cannot repeat, so a bug can cost someone a meeting. These
rules keep the code safe to change. [CONTRIBUTING.md](../CONTRIBUTING.md#the-rules) lists them with
the command that checks each one, and says how to set up, run and submit a change;
[architecture.md](architecture.md) says how the pieces fit.

## Write the failing test first

Every change starts with a test that fails. Then write the code that makes it pass, then clean up.

A bug fix starts with a test that reproduces the bug, at the lowest level that can show it:

1. a pure function, such as the lifecycle reducer (`reduceLifecycle`);
2. one module, with its browser APIs faked;
3. the page session (`createPageSession`), which wires the modules together;
4. the end-to-end run in a real Firefox (`pnpm test:e2e`).

A test at the lowest level is fast and points at the cause. Go higher only when a lower test
cannot show the bug, for example when it depends on how Firefox schedules messages. Keep the
output of the failing test: the pull request shows it (see [Prove the change](#prove-the-change)).

Name a test by the behaviour it guards ("a pause survives an encoder restart"), not by an issue
number.

## Cover all of `src/lib`

`pnpm test:coverage` fails when any statement, branch, function or line under `src/lib` runs in no
test. The threshold is 100 %.

When a branch cannot be reached, remove it. Never exclude it from coverage or mark it with an
ignore comment: code that no test can reach is code nobody knows works.

The thin files in `src/entrypoints/` and `src/wiring/`, and the React UI, are outside `src/lib`.
The end-to-end run exercises them.

## One exported function per file, no classes

Each file under `src/lib` exports one function (types may come with it) and has a test file of the
same name next to it: `parse-settings.ts` and `parse-settings.test.ts`. There are no classes and no
inheritance. `pnpm check:conventions` checks all three.

The style is functional, without being strict about it:

- Logic is a pure function: data in, data out (`reduceLifecycle`, `parseSettings`).
- State lives in a closure returned by a `create*` factory (`createMixer`, `createSaveQueue`).
- Shared data is not mutated: build a new object instead. Mutating a local value inside one
  function is fine when it makes the code simpler.

## Inject browser APIs as `deps`

Modules never reach for `window`, `document`, `browser.*`, timers or media APIs themselves. They
take what they need as a `deps` argument, so a test can pass a fake. The fakes live in
`src/test/fakes/` and behave as Firefox does, including its odd cases.

The files in `src/entrypoints/` are the only place that passes the real APIs in. Keep them thin:
they wire modules together and hold no logic.

## Parse every untyped input with zod

Anything that comes from outside the module's own code is checked with a [zod](https://zod.dev)
schema before it is used: messages from the page, from a Port or from `postMessage`, storage
contents, popup requests, `JSON.parse` results, data read from a service's page. The parsers live
in `src/lib/protocol/parse-*.ts`; settings go through `parseSettings`.

zod runs in its interpreted mode, where it never builds code from a string. In its default mode
it asks the browser whether it may compile code (`new Function`) when it builds its first object
schema, and compiles its parsers when it may. The recorder runs in the meeting page's own world,
under the page's Content Security Policy: the page sees that attempt even when it is refused, and
its policy can report it to the service. So every entrypoint imports `src/wiring/configure-zod.ts`
before anything else, and a new one must too. `src/wiring/configure-zod.test.ts` loads each
entrypoint and fails when zod calls `Function`, and an end-to-end scenario checks that no fake
meeting page reports code built from a string.

The recorder inside a meeting page can be older than the rest of the extension: it keeps running
across an extension update. So the messages from the page to the extension only ever grow. A new
field gets a zod default and is never required, and no message is renamed or reused for something
else. Test each parser with the previous shape of its message too.

## Never force a type

TypeScript runs in its strictest settings (`tsconfig.json`). On top of that, production code has
no:

- type assertions (`value as X`, `as unknown as X`, `<X>value`);
- non-null assertions (`value!`);
- `any`;
- `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`.

`as const` and `satisfies` are fine. To narrow a wide type, parse it with zod, use a real type
guard (`typeof`, `instanceof`, `in`, or a function that checks and returns `value is X`), or change
the type so the value fits.

`pnpm check:conventions` rejects these in production code and in `scripts/`. Some older test
doubles still hold assertions; the check counts them, and the count may only go down.
`pnpm compile` (`tsc --noEmit`) must be clean. It checks the folders `tsconfig.json` lists under
`include`, not everything in the working copy, so that files git does not track (scratch scripts,
clones of other projects) stay out without a tracked file naming them. A new top-level folder of
TypeScript goes into that list; `pnpm check:conventions` fails on a tracked TypeScript file
outside it.

## Target Firefox only

The extension runs in Firefox 140 or later and the browsers built on it, such as Zen, LibreWolf and
Floorp. Use the newest Firefox APIs freely; there is no Chrome build and no fallback for older
versions.

When the code relies on how Firefox behaves, check it in the Gecko source or in Bugzilla, and say
in the comment what you found and where.

## Keep each service in its own folder

Code that knows about one meeting service (Google Meet, Zoom, Microsoft Teams) lives in
`src/lib/providers/<service>/`, plus its two thin entrypoints and its fake page in
`src/test/fixtures/`. Everything else (the page session, the mixer, the encoders, the bridge, the
background) names no service. A feature added there works for every service.
[architecture.md](architecture.md#meeting-services) describes the contract a service implements.

Read a service's page structure from the live page, in Firefox, and write down the date you
checked it. Saved pages of real meetings hold other people's names: read them for structure and
never commit them.

## Write comments a stranger can follow

A comment says why the code is the way it is, in words that make sense to someone who has only the
repository. It does not point to a private note, a chat or a closed discussion. Where a public
source helps, cite it: a Gecko file, a Bugzilla bug, a specification.

Tracked files hold no personal data, credentials or paths of one machine (`/home/<name>/…`). Use a
placeholder such as `<you>` or `<working copy>`.

## Bundle only libraries under a permissive licence or MPL-2.0

The project is MIT, so a library the extension bundles must be under a permissive licence (MIT,
ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD) or under MPL-2.0, never GPL, LGPL or AGPL.
MPL-2.0 is copyleft per file: the library's own files keep it, and the extension around them stays
MIT. Tools that only run at build or test time leave no code in the extension and may be under any
open-source licence.

Every `pnpm build` checks it. The build lists the packages whose code ends up in the extension,
the ones the stylesheet imports included, and fails when one of them is under another licence,
names none, or comes without a licence text. Otherwise it writes the project's `LICENSE` and
`THIRD-PARTY-NOTICES.md` into the extension: each package with its version, its licence and the
licence's text, and where the source of an MPL library is. Those licences ask whoever ships the
code to pass them on. When a package's npm release has no licence file, the build says so: put the
one from the package's repository in
[`scripts/notices/licence-texts/`](../scripts/notices/licence-texts/README.md).

## Keep the build reproducible from its sources

addons.mozilla.org's reviewers rebuild the extension from the sources zip, with the commands of
[`README-REVIEWERS.md`](../README-REVIEWERS.md), and compare their build with the XPI. There must
be no difference. The sources zip holds the files git tracks, minus tests and hidden files, so the
build may read nothing else: no test, nothing under `.github/`, no file git does not know yet.

The popup's and the Options page's CSS is the trap. Tailwind writes a rule for every class name it
finds in the files it scans, and left to itself it scans the whole working copy, so a word in a
test or a doc once added rules to the extension. `src/styles/globals.css` limits it to
`src/entrypoints/` and `src/components/`, without tests: a page or a component in another folder
needs its folder added there.

The build does not depend on the machine either: the same files come out on x86-64 and ARM64, and
with Node 22 or 24. CI's **Reproducible build** job rebuilds every change from its sources zip and
compares; after `pnpm zip` you can run the same check yourself:

```bash
scripts/release/check-reproducible-build.sh .output/zen-recorder-<version>-firefox.zip \
  .output/zen-recorder-<version>-sources.zip
```

## Keep functions small, files short and blocks unrepeated

`pnpm check:quality` measures every function and file and fails when a value crosses its threshold,
unless the baseline of known offenders allows it. The thresholds are in `eslint.config.js`, in
plain numbers:

| Measure | Production code and `scripts/` | Tests, fakes and the e2e harness |
| --- | --- | --- |
| Cognitive complexity (how hard a function is to follow: nesting, breaks in the flow) | 15 | 15 |
| Cyclomatic complexity (independent paths through a function) | 10 | 15 |
| Lines per function | 80 | 160 |
| Lines per file | 400 | 800 |
| Nested `if`/`for`/`while`/`switch`/`try` | 3 | 3 |
| Parameters | 4 | 5 |
| Statements per function | 40 | 60 |
| Nested callbacks | 3 | 5 |
| Conditional operators in one expression | 3 | 3 |
| Cases in a `switch` | 30 | 30 |
| Functions nested in functions | 5 | 5 |
| Two functions with the same body | none | none |
| A string literal repeated three times or more | none | allowed |

Duplicated blocks are measured separately (`.jscpd.json`): a block of 100 tokens over 10 or more
lines that appears twice, in one file or in two, is a clone, and a new clone fails the check.

The numbers come from the rule set SonarQube runs for JavaScript and TypeScript
(`eslint-plugin-sonarjs`, run through ESLint, offline) at SonarQube's defaults where it has them,
and tighter for size: a module here is one function, and most of the long functions are the
`create*` factories, which hold every closure they return. Tests get twice the size limits because a
`describe` callback is a function to these rules. Biome stays the linter and formatter, and Biome's
own complexity rules stay off, so every measure has one implementation and one number. The
duplication threshold is SonarQube's too (jscpd finds the blocks).

The code already over a threshold is listed, with its value, in `quality-baseline.json` (one entry
per file, function and measure) and `.jscpd-baseline.json` (one fingerprint per known clone). An
entry allows that value and nothing above it, and the files may only shrink: when a function
improves, or an entry no longer matches anything, the check fails until
`pnpm check:quality --update-baseline` rewrites both files from the current code, so every gain is
kept. A function is named by the chain of functions around it (`createPageSession > handle >
arrow#2`), not by its line, so edits above it change nothing. Adding an entry by hand is not a
fix; splitting the function is. Neither is an inline ESLint comment (`// eslint-disable-next-line`,
`/* eslint-disable rule */`): ESLint ignores every one (`noInlineConfig` in `eslint.config.js`),
so the finding is still reported, and the check fails on the comment itself (`no-inline-config`)
until it is removed; `--update-baseline` never records one. The baseline, which a reviewer sees
in the diff, is the only way to accept a finding. Biome's own `biome-ignore` comments are
Biome's business and unaffected.

## Import in one direction

`pnpm check:quality` fails on a circular import: two modules that import each other, directly or
through others. dependency-cruiser follows every import in `src/` and `scripts/`, `import type`
included, with the rules of `.dependency-cruiser.cjs`, and the check prints each cycle as the
chain of files:

```text
Import rules (.dependency-cruiser.cjs): 1 broken
  no-circular  src/lib/page/reduce-lifecycle.ts → src/lib/types.ts → src/lib/page/reduce-lifecycle.ts
```

Modules in a cycle can be read, tested and loaded only together, and a cycle between a `create*`
factory and a module it returns is easy to add without noticing. The code has none, so there is no
baseline: any cycle fails. Break one by moving what both files need into a module of its own (often
a `types.ts`), so the imports run one way.

The same check fails on a relative or `@/` import that dependency-cruiser cannot resolve
(`not-to-unresolvable`), because it would not see a cycle through it. TypeScript already refuses
an import of a missing file, so this one only fails when dependency-cruiser resolves imports
differently from TypeScript; the fix then belongs in `.dependency-cruiser.cjs`.

## Leave nothing unused

`pnpm check:quality` runs knip (`knip.jsonc`) and fails on a file nothing imports, an export or
exported type nothing imports, a dependency nothing uses, an import it cannot resolve, and a
binary a script calls that no package provides. Unused code is code a reader still has to read,
and an export says "other modules use this", which an unused one gets wrong.

```text
  src/lib/page/reduce-lifecycle.ts:290  throwawayHelper  unused-export  new offender
```

Use it, delete it, or drop the `export` keyword when only its own file uses it. knip finds the
entry points itself (the WXT entrypoints, the tests, the scripts `package.json` runs); something
used in a way it cannot see, such as a script started by its path or a system tool like `ffmpeg`,
goes into `knip.jsonc` with the reason next to it. The generated components in `src/components/ui`
are not checked.

What the code already had when the check came in (mostly exported types) is listed in
`quality-baseline.json`, one entry per file, name and kind (`unused-type`, `unused-export`,
`unused-dev-dependency`, ...), like the other measures. A finding not listed fails; a listed one
that is gone fails as a "stale entry" until `pnpm check:quality --update-baseline` removes it, so
the list only shrinks.

## Avoid SonarQube's code smells

`pnpm check:quality` also runs the code-smell and security-hotspot rules SonarQube recommends for
JavaScript and TypeScript (`eslint-plugin-sonarjs`, set up in `eslint.config.js`): a nested
ternary, a regular expression that can backtrack for a long time, `Math.random` where randomness
might matter, a test assertion less specific than it could be. Each one fails with the rule's name:

```text
  src/lib/page/reduce-lifecycle.ts:291  throwawayLabel  no-nested-conditional  new offender
```

What each rule asks for, with examples, is on [rules.sonarsource.com](https://rules.sonarsource.com/javascript/)
(search for the rule's name). Rewrite the code the way the rule's page shows.

The rules are SonarQube's recommended set, applied the way SonarQube applies them, with three
kinds of exception, all listed in `eslint.config.js`:

- Rules SonarSource writes for test code (`prefer-specific-assertions`, `no-trivial-assertions`,
  ...) run on tests only, and every other rule on production code and `scripts/` only.
- Rules for a library run only when `package.json` depends on it (the AWS CDK rules, for
  instance, run only with `aws-cdk-lib`).
- A rule stays off when an enabled Biome rule checks the same thing (`no-unused-vars` is Biome's
  `noUnusedVariables`, for instance), so every problem has one report, and when it misreads this
  project (`no-redundant-optional`, under `exactOptionalPropertyTypes`). A unit test fails when a
  Biome rule named there is turned off, and when SonarSource's metadata disagrees with the lists.

The smells the code already had are in `quality-baseline.json`, one entry per file, function and
rule, like the metrics: a new one fails, and a fixed one fails as a "stale entry" (or "gone", when
the function still has others of that rule) until `pnpm check:quality --update-baseline` records
it.

## Prove the change

Every pull request shows what it changed, with the same check run on the old code and on the new:
for a bug, the reproduction failing before and passing after; for a feature, the behaviour missing
before and present after. [CONTRIBUTING.md](../CONTRIBUTING.md#before-and-after-evidence) says
what that evidence looks like and where it goes.
