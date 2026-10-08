<!--
Thanks for the pull request. CONTRIBUTING.md says what each section needs:
https://github.com/zenfully-org/zen-recorder/blob/main/CONTRIBUTING.md
Delete the comments as you fill the sections in.
-->

Closes #

## Root cause

<!-- A bug fix: why the old code did what it did. Delete this section for a feature. -->

## What changed

## Why this way

<!-- Each design decision: what you chose, why, and what you rejected. -->

## Before / After

<!--
The same check on the old code and on the new. Capture the "before" first.
A bug fix: the reproduction failing before and passing after (the failing test's output), plus the
real symptom where it can be shown: the saved file (ffprobe output, duration, audio levels, frame
count), Diagnostics lines, console errors, a screenshot or a screencast.
A feature: the behaviour missing before and present after: an output file, a screenshot, a log.
Paste text inline, in a <details> block when it is long. Drag images and videos into this
description; never commit them.
-->

**Before:**

**After:**

## Gate

<!-- The last lines of each command, run on the commit you push. -->

<details><summary>pnpm check · pnpm compile · pnpm test:coverage · pnpm test:e2e</summary>

```text

```

</details>

## Definition of done

- [ ] The gate is green on my machine (`pnpm check`, `pnpm compile`, `pnpm test:coverage`), and every CI check is green here: **Gate**, **Reproducible build** and the three **E2E** jobs.
- [ ] `pnpm test:e2e` is green, or the change touches none of recording, storage, messaging, saving the file and the entrypoints. A bug fix adds the scenario that would have caught it, where one can.
- [ ] I tried it in a browser: a development build on the fake meeting pages, or on the real service when the change concerns how a service's page or media is read.
- [ ] The Before / After evidence above shows what changed.
- [ ] The docs match the code: `README.md`, `CHANGELOG.md` (under "Unreleased"), `docs/architecture.md` and `docs/development-rules.md`, as they apply.
- [ ] "Why this way" explains each design decision: what I chose, why, and what I rejected.
- [ ] No AI credits: the commits and this description credit people only, with no "generated with" lines and no co-author trailers for tools.
