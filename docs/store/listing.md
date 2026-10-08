# Store and repository texts

Every place that presents Zen Recorder says the same thing: what it is (a local meeting recorder
for Firefox-based browsers), why it exists (each meeting becomes files on your own disk, made to be
the best input for an AI assistant), that nothing leaves the machine, and that it is an independent
project. This file holds the texts that live outside the repository's own pages, ready to
paste.

`src/lib/project/get-project-texts.ts` holds the extension's name, the manifest description and the
independence notice. Its test fails when this file or `README.md` says something else, so change a
text there and here together.

| Text | Where it goes | Who sets it |
|---|---|---|
| Manifest description | `description` in the built `manifest.json` (from `wxt.config.ts`); shown in `about:addons` | the build |
| AMO summary | the addons.mozilla.org listing, under the name | the release workflow, with each version |
| AMO description | the addons.mozilla.org listing, the long text | the maintainer, once the listing exists |
| Repository description | the GitHub repository's "About" box | the maintainer, when the public repository is set up |
| Independence notice | `README.md` (first screen), the Options page footer, the AMO description, the release notes | the build, the docs, and whoever writes the release notes |
| Listing details | the other fields of the addons.mozilla.org listing: categories, licence, links, privacy policy | the release workflow (categories, licence), the maintainer (the rest, once the listing exists) |
| Notes to reviewer | the addons.mozilla.org submission of a listed version; only Mozilla's reviewers see them | the release workflow, with each listed version |

The privacy policy is [`privacy.md`](privacy.md), published as the project site's
`privacy.html`; [`permissions.md`](permissions.md) says why the extension needs each permission;
[`submission.md`](submission.md) is the checklist for submitting the listing.

## Independence notice

The full notice, in these words wherever there is room for it:

```text
Zen Recorder is an independent project. It is not affiliated with, endorsed by or sponsored by Zen Browser or its team. The maintainer uses Zen Browser, which is why the recorder targets Firefox-based browsers.
```

The short form, where there is not: "Independent project, not affiliated with Zen Browser."

## Manifest description

At most 250 characters, AMO's limit for the listing's summary, which AMO fills from this field
(addons-linter checks the limit since September 2026). It ends with the short notice.

```text
Records your Google Meet, Zoom and Microsoft Teams calls to files on your own disk, ready for an AI assistant to analyse. Nothing leaves your machine. Independent project, not affiliated with Zen Browser.
```

## AMO summary

The same text as the manifest description. The release workflow sends it with each version
(`.github/amo-metadata/`), and keeping the two the same means the listing never says something
the manifest does not.

```text
Records your Google Meet, Zoom and Microsoft Teams calls to files on your own disk, ready for an AI assistant to analyse. Nothing leaves your machine. Independent project, not affiliated with Zen Browser.
```

## AMO description

AMO's description field takes a limited Markdown: bold, italics, links, lists, blockquotes and
code, but no headings. So the sections below start with a bold line.

```markdown
**Zen Recorder records your Google Meet, Zoom and Microsoft Teams calls to files on your own disk.** Nothing leaves your machine: no servers, no accounts, no uploads, no telemetry.

Each meeting becomes a WebM file in your Downloads folder: everyone's audio, your own microphone, and the video tiles and shared screen laid out as you see them. Structured notes about each meeting (who was there, what happened, with times that point into the recording) are in progress. The aim is to be the best input for an AI assistant that analyses a meeting.

**What it does**

- Starts recording once you are in a call with someone else; never on a pre-join screen, in a lobby or in a waiting room. Stops and saves when the call ends.
- Pause, Resume and Stop from the overlay on the meeting page, from the toolbar popup, or with Alt+Shift+R.
- Crash-safe: the recording is kept every few seconds, so a closed tab or a browser crash still leaves a file.
- Video is on by default (1080p, 15 fps, about 1.1 GB per hour); audio only takes about 30 MB per hour. Both are set in Options.
- Muting yourself in the meeting mutes your microphone in the recording too.

**Where it works**

- Google Meet (meet.google.com)
- Zoom's web client ("Join from browser"), not the desktop app
- Microsoft Teams on the web (teams.microsoft.com, teams.live.com, teams.cloud.microsoft)

**Privacy**

Recordings are written to your own disk and nowhere else. While a recording runs, its pieces are kept in the browser's storage and deleted once the file is saved. The extension has no accounts, no analytics and no crash reporting. The Diagnostics log is copied to your clipboard only when you press its button. The full privacy policy: https://zenfully-org.github.io/zen-recorder/privacy.html

**Consent**

This records other people without any browser-level indicator. Many jurisdictions require all-party consent. Tell the people in your call.

**Independent project**

> Zen Recorder is an independent project. It is not affiliated with, endorsed by or sponsored by Zen Browser or its team. The maintainer uses Zen Browser, which is why the recorder targets Firefox-based browsers.

Source code and issues, under the MIT licence: https://github.com/zenfully-org/zen-recorder
```

## Listing details

The other fields of the Developer Hub's submission, besides the texts above.

| Field | Value |
|---|---|
| Name | Zen Recorder (AMO takes it from the manifest) |
| Add-on URL | `zen-recorder`, so the listing is at https://addons.mozilla.org/firefox/addon/zen-recorder/ |
| Compatible platforms | Firefox only: the extension does not run on Firefox for Android |
| Source code | yes: the build bundles and minifies, so upload `zen-recorder-<version>-sources.zip` |
| Firefox categories | `social-communication`, `photos-music-videos` (two at most) |
| Experimental | no |
| Requires payment, non-free services or software, or additional hardware | no |
| Support email | none: leave it empty |
| Support website | https://github.com/zenfully-org/zen-recorder/issues |
| Homepage | https://zenfully-org.github.io/zen-recorder/ |
| Licence | MIT |
| Privacy policy | tick "This add-on has a Privacy Policy" and paste [`privacy.md`](privacy.md) from its second line (AMO shows its own title) |
| Notes to reviewer | the text below |

The release workflow sends the categories and the licence with each signed version
(`.github/amo-metadata/listed.json` and `unlisted.json`); a test keeps the categories equal to
this table and the licence to `package.json`'s.

## Notes to reviewer

For a listed version. AMO's field takes plain text, at most 3,000 characters; only Mozilla's
reviewers see it. The release workflow sends this text with each listed version
(`.github/amo-metadata/listed.json`, which a test keeps equal to it), and its own notes with the
self-distributed build (`.github/amo-metadata/unlisted.json`).

```text
Zen Recorder records the user's own Google Meet, Zoom and Microsoft Teams calls to a WebM file in their Downloads folder. It makes no network requests of its own and collects no data (data_collection_permissions: none).

Build: README-REVIEWERS.md at the root of the attached sources says how to rebuild this XPI and what each step does. In short, with Node 24 on Ubuntu 24.04 (x86-64 or ARM64): corepack pnpm install --frozen-lockfile, then corepack pnpm build. .output/firefox-mv3 then equals this XPI file for file; the project's CI checks that on every change.

Permissions (docs/store/permissions.md in the sources has the details):
- storage: the settings and the Diagnostics log.
- unlimitedStorage: a recording in progress is kept in IndexedDB, about 1.1 GB per hour with video, so that a crash loses nothing; it is deleted once the file is saved.
- downloads: saves the file, waits until Firefox has written it, and shows or opens it from the popup.
- notifications: "Meeting recording saved" with the file's name.
- alarms: shortly after start-up, the recovery pass saves the recordings a crashed tab left behind.
- Host permissions (meet.google.com, *.zoom.us, teams.microsoft.com, teams.live.com, teams.cloud.microsoft): on those sites only, a content script in the page's world (MAIN) wraps getUserMedia and RTCPeerConnection to receive the call's audio and video tracks, and records them in the page: an AudioWorklet loaded from a blob: URL, WebCodecs, and Mediabunny (MPL-2.0) for WebM. An isolated content script relays the recorded pieces to the background page, which stores them and saves the file.

Linter: no errors; README-REVIEWERS.md explains the 11 warnings. The 7 DANGEROUS_EVAL are zod 4's probe new Function("") (allowsEval) and its parser compiler (Doc.compile). Neither runs: every entrypoint first imports src/wiring/configure-zod.ts, which sets z.config({ jitless: true }) before any schema is built, so zod only interprets. The 2 UNSAFE_VAR_ASSIGNMENT are inside React DOM.

To try it: join a Google Meet call with someone else (a second browser profile works). Recording starts once you have been let in and someone else is there, and the pill on the page says so. Leave the call or press Stop in the popup, and the file is saved under Downloads/zen-recorder/.
```

## Images

The listing's icon comes from the manifest. Screenshots are 1280 by 800 pixels (AMO's display
size): the pill on a meeting page, the popup, the Options page, and a saved file. They are made
with the project's logo and are not in the repository yet.

## Repository description

One line for the GitHub repository's "About" box.

```text
Local meeting recorder for Firefox-based browsers: Google Meet, Zoom and Teams calls become files on your own disk, ready for an AI assistant. An independent project, not affiliated with Zen Browser.
```
