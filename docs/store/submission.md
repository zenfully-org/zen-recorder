# Listing Zen Recorder on addons.mozilla.org

The steps to list Zen Recorder on addons.mozilla.org (AMO). The maintainer does them: the listing
belongs to the AMO account that signs the releases. Firefox, Zen, LibreWolf, Floorp and Waterfox
all install add-ons from AMO.

The release workflow makes the listing. The add-on already exists on AMO once the first release
is signed, on AMO's unlisted channel, for GitHub Releases. Set the repository variable
`AMO_CHANNEL` to `listed` and make a release: AMO signs that version on the listed channel, which
creates the listing, and every later release goes there too. The rest of the listing (the
description, the privacy policy, the links and the images) is then filled in on the Developer Hub.

## Ready in the repository

| What | Where |
|---|---|
| Summary, description, categories, links, notes to reviewer | [`listing.md`](listing.md) |
| What each listed release sends to AMO: the summary, the categories, the licence and the notes to reviewer | [`.github/amo-metadata/listed.json`](../../.github/amo-metadata/listed.json), which a test keeps equal to [`listing.md`](listing.md) |
| Privacy policy | [`privacy.md`](privacy.md), published as `https://zenfully-org.github.io/zen-recorder/privacy.html` |
| Why each permission | [`permissions.md`](permissions.md) |
| How reviewers rebuild the XPI | [`README-REVIEWERS.md`](../../README-REVIEWERS.md), at the root of the sources zip |
| The check that the sources rebuild the XPI | `scripts/release/check-reproducible-build.sh`, run by CI on every change and by the release on its own build |

## Before the first listed release

1. **The version is new to AMO.** AMO keeps one version number per add-on across its listed and
   unlisted channels, deleted versions included, and a listed version must be higher than the
   last listed one. A version the workflow signed unlisted can never be listed, so the first
   listed version is a new release. Do not upload a listed version by hand either: it would take
   a version number no tag has, or the number of the next tag, whose release AMO would then
   refuse to sign.
2. **The privacy page is online**: `https://zenfully-org.github.io/zen-recorder/privacy.html`
   answers. GitHub Pages serves it once the first release has published the site and Pages is
   turned on for the `gh-pages` branch.
3. **The screenshots exist** (see "Images" in [`listing.md`](listing.md)).
4. **The permissions are the narrowest.** Reviewers ask about any permission the code does not
   need. A test keeps [`permissions.md`](permissions.md) and the manifest in step, but only reading
   the code shows that each permission is still used.
5. **CI is green on the release commit**, the "Reproducible build" job included. That job builds
   the listed add-on: `pnpm zip` without `ZEN_RECORDER_CHANNEL`, whose manifest names no update
   manifest, which AMO refuses on a listed version.
6. **The listed release builds.** The release's dry run builds each channel: the "Build (listed)"
   job of a pull request that changes the release, or Actions → Release → Run workflow with the
   mode `dry-run` on the release commit. It checks that the listed XPI names no update manifest
   and rebuilds from its sources.

## Release on the listed channel

1. Set the repository variable once: `gh variable set AMO_CHANNEL --body listed`, or Settings →
   Secrets and variables → Actions → Variables → `AMO_CHANNEL` = `listed`. Leave it there: every
   release from now on is listed.
2. Make the release as CONTRIBUTING's "Making a release" says: the release pull request, then the
   tag. The workflow builds the add-on without `ZEN_RECORDER_CHANNEL`.
3. Approve the `release` environment. `web-ext sign --channel listed` submits the XPI and the
   sources zip with [`.github/amo-metadata/listed.json`](../../.github/amo-metadata/listed.json).
   AMO takes the name from the manifest; with the summary, the categories and the licence from the
   metadata, the first listed version creates the listing. The validation reports no errors and
   11 warnings; [`README-REVIEWERS.md`](../../README-REVIEWERS.md) explains each one.
4. Once AMO approves the version, the workflow attaches the signed XPI to the GitHub Release (the
   file AMO serves), publishes the release, and adds the version to `updates.json`. Copies
   installed from a GitHub Release update to it within a day, and from then on Firefox updates
   them from AMO. If AMO holds the version for a manual review, finish the release as
   CONTRIBUTING's "When signing takes longer" says.

## Complete the listing

AMO shows the listing as soon as it approves the first listed version, so fill in the rest right
after: Developer Hub → **My Add-ons** → Zen Recorder → **Edit Product Page**.

1. The description: the block under "AMO description" in [`listing.md`](listing.md).
2. The rows of "Listing details" in [`listing.md`](listing.md) that the release did not set: the
   add-on URL, the support website, the homepage, "experimental" and "requires payment" (both
   no), and no support e-mail.
3. The privacy policy: tick "This add-on has a Privacy Policy" and paste [`privacy.md`](privacy.md)
   from its second line.
4. The screenshots, under **Images**.

## After

- AMO publishes each listed version once its automatic checks pass. A reviewer may look at it
  later and writes to the account's e-mail address; answer there.
- Check the public page: the summary and the description carry the independence notice, and the
  privacy policy shows.
- Install from AMO in Firefox and in Zen, and make a short recording in each.
- Check the move of a copy installed from a GitHub Release before the listing: after its update
  (about:addons → the gear → **Check for Updates**), it runs the listed version, and the next
  release reaches it from AMO.
- Update the README: the install section lists AMO first and GitHub Releases second, and
  "addons.mozilla.org" leaves "Not available yet". Add a changelog entry under `## Unreleased`.
