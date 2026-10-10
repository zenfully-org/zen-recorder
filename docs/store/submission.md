# Listing Zen Recorder on addons.mozilla.org

Every release of Zen Recorder goes to addons.mozilla.org (AMO), listed, and to GitHub Releases,
with the same version number. The release workflow does both: AMO signs the version on its listed
channel, and the GitHub Release offers the file AMO serves. The first listed release creates the
listing. The maintainer does the steps below: the listing belongs to the AMO account that signs
the releases. Firefox, Zen, LibreWolf, Floorp and Waterfox all install add-ons from AMO.

## Ready in the repository

| What | Where |
|---|---|
| Summary, description, categories, links, notes to reviewer | [`listing.md`](listing.md) |
| What each listed release sends to AMO: the summary, the description, the homepage, the support website, the categories, the licence and the notes to reviewer | [`.github/amo-metadata/listed.json`](../../.github/amo-metadata/listed.json), which a test keeps equal to [`listing.md`](listing.md) |
| Privacy policy | [`privacy.md`](privacy.md), published as `https://zenfully-org.github.io/zen-recorder/privacy.html` |
| Why each permission | [`permissions.md`](permissions.md) |
| How reviewers rebuild the XPI | [`README-REVIEWERS.md`](../../README-REVIEWERS.md), at the root of the sources zip |
| The check that the sources rebuild the XPI | `scripts/release/check-reproducible-build.sh`, run by CI on every change and by the release on its own build |

## Once, before the first release

1. **The AMO account.** AMO's developer accounts are Mozilla accounts, and AMO requires two-step
   authentication on them. Keep the recovery codes safe: Mozilla cannot restore an account whose
   second factor is lost, and the add-on goes with it. The profile's display name shows on the
   listing as its developer.
2. **The API key.** Developer Hub → **Manage API Keys**
   (`https://addons.mozilla.org/en-US/developers/addon/api/key/`): the JWT issuer and the JWT
   secret become the `release` environment's secrets `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`.
3. **The channel.** Set the repository variable once and leave it:
   `gh variable set AMO_CHANNEL --body listed`, or Settings → Secrets and variables → Actions →
   Variables → `AMO_CHANNEL` = `listed`.
4. **No version by hand.** AMO keeps one version number per add-on across its listed and unlisted
   channels, deleted versions included, and a listed version must be higher than the last listed
   one. A version uploaded by hand takes a number no tag has, or the next tag's, whose release AMO
   would then refuse to sign.
5. **The permissions are the narrowest.** Reviewers ask about any permission the code does not
   need. A test keeps [`permissions.md`](permissions.md) and the manifest in step, but only reading
   the code shows that each permission is still used.

## Each release

1. Make the release as CONTRIBUTING's "Making a release" says: the release pull request, then
   Actions → **Start a release** on `main`, which tags the commit and runs the release. CI must be green on the release commit, the "Reproducible build" job included: it builds
   the listed add-on, whose manifest names no update manifest (AMO refuses one on a listed
   version).
2. Approve the `release` environment. `web-ext sign --channel listed` submits the XPI and the
   sources zip with [`.github/amo-metadata/listed.json`](../../.github/amo-metadata/listed.json).
   AMO takes the name from the manifest and the rest of the listing from the metadata: the
   summary, the description, the homepage, the support website, the categories and the licence.
   The first listed version creates the listing with them. The validation reports no errors and
   11 warnings; [`README-REVIEWERS.md`](../../README-REVIEWERS.md) explains each one.
3. Once AMO approves the version, the workflow attaches the signed XPI to the GitHub Release (the
   file AMO serves), publishes the release, and adds the version to `updates.json`. Copies
   installed from a GitHub Release before the listing update to it within a day, and from then on
   Firefox updates them from AMO. If AMO holds the version for a manual review, finish the release
   as CONTRIBUTING's "When signing takes longer" says.

A changed summary goes to AMO's content review; the same text sent again changes nothing.

## Once, after the first release

1. GitHub Pages: Settings → Pages → deploy from the `gh-pages` branch, root. The listing's
   homepage and privacy policy link to it.
2. Complete the listing: Developer Hub → **My Add-ons** → Zen Recorder → **Edit Product Page**.
   - The privacy policy: tick "This add-on has a Privacy Policy" and paste
     [`privacy.md`](privacy.md) from its second line. The release does not send it.
   - "Experimental" and "requires payment": no. No support e-mail.
   - The screenshots, under **Images**, once they exist (see "Images" in
     [`listing.md`](listing.md)).

## After

- AMO publishes each listed version once its automatic checks pass. A reviewer may look at it
  later and writes to the account's e-mail address; answer there.
- Check the public page: the summary and the description carry the independence notice, and the
  privacy policy shows.
- Install from AMO in Firefox and in Zen, and make a short recording in each.
