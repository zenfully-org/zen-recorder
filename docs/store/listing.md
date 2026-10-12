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
| AMO description | the addons.mozilla.org listing, the long text | the release workflow, with each listed version |
| Repository description | the GitHub repository's "About" box | the maintainer, when the public repository is set up |
| Independence notice | `README.md` (first screen), the Options page footer, the AMO description, the release notes | the build, the docs, and whoever writes the release notes |
| Listing details | the other fields of the addons.mozilla.org listing: categories, licence, links, privacy policy | the release workflow (categories, licence, homepage, support website), the maintainer (the privacy policy and the images, once the listing exists) |
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

Short and plain: what you get, how it works, where it works, then privacy and consent. AMO's
description field takes a limited Markdown (bold, italics, links, lists, blockquotes and code, no
headings), so each part starts with a bold word. The release workflow sends it with each listed
version (`.github/amo-metadata/listed.json`, which a test keeps equal to it).

```markdown
**Record your Google Meet, Zoom and Microsoft Teams calls to your own computer.** Nothing is uploaded.

Each meeting is saved as two files in your Downloads folder:

- **The recording** (WebM): everyone's voice, your microphone, and the video as you see it, shared screen included.
- **The notes** (Markdown): what the meeting was, when the recording started and stopped, and what happened when, with times that point into the recording. Ready to hand to an AI assistant.

**How it works**

- Starts by itself once you are in a call with someone else, and saves when the call ends.
- Record, pause and stop from the small card on the meeting page or from the toolbar button. Alt+Shift+R starts or stops.
- A tab that closes or crashes still leaves its file.
- Video, or audio only: about 1.1 GB or 30 MB per hour.

**Works with** Google Meet, Zoom in the browser ("Join from browser") and Microsoft Teams on the web, in Firefox, Zen, LibreWolf, Floorp and Waterfox on the desktop.

**Private.** No servers, no accounts, no tracking. Privacy policy: https://zenfully-org.github.io/zen-recorder/privacy.html

**Ask first.** Recording people can require their consent where you live. Tell the people in your call.

Open source, MIT licence: https://github.com/zenfully-org/zen-recorder

> Zen Recorder is an independent project. It is not affiliated with, endorsed by or sponsored by Zen Browser or its team. The maintainer uses Zen Browser, which is why the recorder targets Firefox-based browsers.
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
this table and the licence to `package.json`'s. A listed version also sends the description, the
homepage and the support website (`listed.json`), which a test keeps equal to this file. The
privacy policy goes in by hand, once: web-ext sends no privacy policy.

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
- downloads: saves the file, waits until Firefox has written it, and shows it in its folder from the popup.
- notifications: "Meeting recording saved" with the file's name.
- alarms: shortly after start-up, the recovery pass saves the recordings a crashed tab left behind.
- Host permissions (meet.google.com, *.zoom.us, teams.microsoft.com, teams.live.com, teams.cloud.microsoft): on those sites only, a content script in the page's world (MAIN) wraps getUserMedia and RTCPeerConnection to receive the call's audio and video tracks, and records them in the page: an AudioWorklet loaded from a blob: URL, WebCodecs, and Mediabunny (MPL-2.0) for WebM. An isolated content script relays the recorded pieces to the background page, which stores them and saves the file.

Linter: no errors; README-REVIEWERS.md explains the 11 warnings. The 7 DANGEROUS_EVAL are zod 4's probe new Function("") (allowsEval) and its parser compiler (Doc.compile). Neither runs: every entrypoint first imports src/wiring/configure-zod.ts, which sets z.config({ jitless: true }) before any schema is built, so zod only interprets. The 2 UNSAFE_VAR_ASSIGNMENT are inside React DOM.

To try it: join a Google Meet call with someone else (a second browser profile works). Recording starts once you have been let in and someone else is there, and the status card on the page says so. Leave the call or press Stop in the popup, and the file is saved under Downloads/zen-recorder/.
```

## Images

In [`images/`](images/), for the Developer Hub: **Edit Product Page** → **Images**. The release
sends none of them: web-ext uploads no images, so the maintainer adds them once, and again when
what they show changes.

- **Icon:** [`images/icon.png`](images/icon.png), 128 by 128. AMO does not take the listing's
  icon from the manifest: it wants an upload, a square PNG or JPG of at least 128 pixels, and
  makes the 32 and 64 pixel sizes from it itself. This file is the extension's icon
  (`src/assets/icon.svg`) rendered as the build renders `icons/128.png`, byte for byte; make it
  again when the icon changes.
- **Screenshots:** 1280 by 800 pixels, AMO's display size, in this order, each with its caption:

| File | Caption |
|---|---|
| [`images/screenshot-1-status-card.png`](images/screenshot-1-status-card.png) | The status card on the meeting page while a call records: the time, the microphone, the video, Pause and Stop. |
| [`images/screenshot-2-popup.png`](images/screenshot-2-popup.png) | The toolbar popup: the meeting being recorded, with Pause and Stop & save, and the recordings, with Show file. |
| [`images/screenshot-3-options.png`](images/screenshot-3-options.png) | The settings: whether and when to record, the audio quality, the status card, and the video. |
| [`images/screenshot-4-recording-and-notes.png`](images/screenshot-4-recording-and-notes.png) | Each meeting becomes two files on your own disk: the recording, and its notes with the meeting's title, service, date, link and length. |

They show the project's fake Google Meet page with invented names (You, Remote Person, Guest Two),
never a real meeting. For the pictures only, the fake page's test buttons and log are hidden, and
its camera pictures, which carry frame counters and test patterns, are replaced by a calm drawing
per person; the recorder records what the page shows, so the saved recording in the fourth has the
same tiles. The extension's card, popup and Options page are as Firefox drew them, the popup and
the Options page at 1.5 and 1.25 times their size so their words stay readable. The second places
the popup where its panel opens, under the toolbar button, over the call. The fourth shows the two
saved files, a frame of the recording and its notes file as written, in UTC, from its title on,
each line under its number in the file. The notes end before the first line that says something
was not known or not observed, or else before the data block, and "…" says that the file goes on.
Today that is after the "Recorded" line: the lines after it say that the notes do not observe the
start, the microphone and the participants yet. Once the notes name the participants and what
happened, the fourth shows them.

Take them again whenever the status card, the popup, the Options page or the notes change what
they show. One command retakes all four:

```bash
pnpm store:screenshots
```

It builds the end-to-end flavour (`pnpm build:e2e`), records the call in the end-to-end run's
Firefox (the one `pnpm setup:firefox` downloads, with the same environment variables as
`pnpm test:e2e`) and writes the four files to [`images/`](images/), in about two minutes. Each
must be 1280 by 800 pixels and under 100 kB, or the run writes none of them. Upload them to the
listing again afterwards ([`submission.md`](submission.md)). The script is
`scripts/store/take-store-screenshots.ts`; its header says what each picture shows and how.

## Repository description

One line for the GitHub repository's "About" box.

```text
Local meeting recorder for Firefox-based browsers: Google Meet, Zoom and Teams calls become files on your own disk, ready for an AI assistant. An independent project, not affiliated with Zen Browser.
```
