# Zen Recorder

Zen Recorder is a local meeting recorder for Firefox-based browsers. It records your Google Meet,
Zoom and Microsoft Teams calls. Each meeting becomes files on your own disk:

- the recording: everyone's audio, your microphone, and the video tiles and shared screen laid out
  as you see them;
- soon, structured notes and metadata about it: who was there, when, and what happened, with times
  that point into the recording.

It is made to be the best input for an AI assistant that analyses a meeting: the assistant reads
the notes, then the recording, and does not have to guess.

Nothing leaves your machine: no servers, no accounts, no uploads, no telemetry.

> Zen Recorder is an independent project. It is not affiliated with, endorsed by or sponsored by
> Zen Browser or its team. The maintainer uses Zen Browser, which is why the recorder targets
> Firefox-based browsers.

## Install

Each release on GitHub carries a signed add-on file, `zen-recorder-<version>.xpi`. Mozilla's
add-on service checks and signs it, so it installs in Firefox and in the browsers built on it
(Zen, LibreWolf, Floorp, Waterfox and others), version 140 or later, on the desktop.

1. Download `zen-recorder-<version>.xpi` from the
   [latest release](https://github.com/zenfully-org/zen-recorder/releases/latest).
2. Open the file in your browser: drag it onto a browser window, or open `about:addons`, click the
   gear icon and choose **Install Add-on From File…**.
3. Accept the install prompt. It lists the sites the recorder works on (Google Meet, Zoom,
   Microsoft Teams); leave them all allowed.

**Zen:** the same steps. You do not need to change any pref, because the file is signed.

**Coming from 0.3.0 or older:** the add-on id changed, so Firefox installs the new version as a
second add-on and carries nothing over. Follow the one-time steps for the new add-on id in
[CHANGELOG.md](CHANGELOG.md) first.

**Updates are automatic.** The browser checks for a new version once a day and installs it. After
an update the popup may show **Grant access** for a service that is new in that version: Firefox
asks for each site's permission separately. The popup shows the same button for a site you left
out at install or turned off later.

Not available yet:

- **addons.mozilla.org.** A listing there is planned; until then, install from GitHub Releases.
- **The first release.** If the releases page is still empty, the first signed release is on its
  way. You can build the extension from source meanwhile ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Meeting notes.** The notes file next to each recording is in progress (see
  [Meeting notes](#meeting-notes-coming)).
- **Other browsers.** Chrome, Edge and other Chromium-based browsers are not supported, and
  neither is Firefox for Android.

## What it does

- Detects when you are in a call and starts recording once you have been let in and someone else
  is there. Nothing is recorded on a pre-join screen, in a lobby or in a waiting room.
- Stops and saves when the call ends (or when you press Stop). Pause/Resume from the status card on
  the meeting page, the toolbar popup, or `Alt+Shift+R`. The file keeps the audio up to the moment you press Pause or Stop,
  even when the meeting page is busy, and nothing of a pause; on a busy page saving starts a moment
  later.
- The status card on the meeting page stays out of the way: a small pill on the right edge with a
  dot that says whether it records (red: recording, amber bars: paused, a turning ring: saving, a
  grey ring: not recording yet, an amber square: not recording until the add-on has taken what
  the page holds) and how long it has run. Click it, or press Enter on it, for the
  details: the microphone, the video, and the Record, Pause, Resume and Stop buttons; click again
  or press Escape to close them. Drag it anywhere: it comes back where you left it on that service
  (Meet, Zoom and Teams each keep their own place), after a reload and in later meetings, and stays
  inside the window when the window gets smaller. "Saved" and error messages appear next to it. It
  never takes the keyboard focus from the meeting, and keys pressed on it do not reach the
  meeting's shortcuts. **Options → REC indicator** turns it off.
- Video (on by default, 1080p / 15 fps / 2.5 Mbps ≈ 1.1 GB per hour; configurable or off in Options)
  composites the meeting's own video tiles with name labels, including a shared screen, and keeps
  recording while the tab is in the background. Chat and captions panels are not captured. When the
  machine cannot keep up, the frame rate drops to 7.5 or 5 fps and comes back once the load allows;
  while nothing on screen changes (cameras off, a still slide) and the tab is in front, only about one
  frame per second is drawn and encoded.
- Muting in the meeting mutes your microphone in the recording too, on every service. The
  recording follows the microphone the meeting has open: switching devices or running the
  service's microphone test keeps your voice in it.
- Audio and video stay in step for the whole call: the file follows the clock of the audio it
  records, and a busy tab that gets the audio late puts no gaps in it. The first second or so of a
  recording can be silent while the browser starts the recorder's audio.
- Crash-safe: audio and video are persisted every few seconds. Closing the meeting tab or leaving
  the page ends the recording: the file is saved within seconds under its usual name, without the
  last second or two the tab had not handed over yet. A crashed tab still yields a `(recovered)`
  file about 10 seconds later, and a browser crash one the next time the browser starts. If even
  that cannot be stored (a full disk), the popup says "not saved yet (tab closed)" a minute later
  and offers **Retry save**; a retried save keeps `(recovered)` in the name. When the
  encoder fails mid-call, the file so far is saved and the recording goes on in a new file
  (audio-only if the video was the problem), which starts at once, even while the add-on cannot
  take the recording. If you had paused, it stays paused: nothing is
  recorded until you press Resume, which starts the new file. An encoder that fails four times in
  a row is not restarted again; the Diagnostics log says so, and Record tries again.
- When the add-on cannot take the recording for minutes (a full disk, or the add-on disabled
  during a call), the meeting page keeps every part of it and holds at most 64 MiB of video
  recordings, about 3.5 minutes, and 64 MiB of audio-only ones, however many files that is.
  Past that, the video stops and the rest of the call is recorded as audio only, in a new file,
  which takes 40 times less; when the audio-only part fills up too, recording stops until the
  add-on has taken it. While that lasts, the status card says so in amber words, **Audio only**
  or **Waiting for space**, its details say what happened, and a message next to it tells you
  the first time; the words go once the add-on has taken what the page held. A recording that ends and starts again meanwhile (an encoder error, Stop
  then Record, a new meeting in the same tab) goes on at once in a new file. Every file is saved
  whole once the add-on is back, even when it restarted meanwhile, and the Diagnostics log says
  why each one stopped. When the disk is full, the meeting tab that records says so in an error
  message next to its status card, once, so you can free some space before the video stops; it
  says so again only if saving worked in between.
- Playback: VLC and every browser play the WebM files as-is. Windows Media Player needs the free
  "VP9 Video Extensions" and "Web Media Extensions" from the Microsoft Store.
- Survives extension reloads/updates mid-call (the recorder inside the page keeps going and the
  file stays whole), even one that comes just as the recording stops: the file is still saved
  under its own name. The popup's **Diagnostics** button copies a log of what happened for bug reports,
  including what the video costs on this machine ("video perf" lines) and how the audio keeps time
  ("audio clock" lines).

### Per service

| Service | Where it works | Notes |
|---|---|---|
| Google Meet | `meet.google.com` | The reference implementation; live-tested with two participants and a shared screen. |
| Zoom | the web client (`app.zoom.us/wc/…`, "Join from browser"); not the desktop app | Join the meeting's audio ("Join Audio by Computer") or there is nothing to record. While the Zoom tab is in the background Zoom stops showing your own camera, so the recording shows initials for that time (audio is unaffected). The recording ends when you leave or when the host ends the meeting (then about 5 seconds later, or as soon as you click OK). Closing the tab ends it too. Live-tested with two participants, a screen share and the waiting room. |
| Microsoft Teams | `teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft` | Signed-in calls have no meeting id in the URL: `{code}` in the filename template is `teams-call` for them (the default template uses the title). Live-tested up to the lobby so far; the in-call test is pending. |

> This records other people without any browser-level indicator. Many jurisdictions require all-party
> consent. Tell the people in your call.

## Files

Recordings: `Downloads/zen-recorder/YYYY-MM-DD_HH-mm_<meeting title>.webm` (configurable in Settings).
A name that is already taken gets `(1)`, `(2)`… before the extension, for example two tabs of one
meeting or two meetings with the same title started in the same minute. Files are saved one at a
time, so recordings that end together are all kept. A name keeps the title's letters and emoji but
drops what Firefox does not allow in a file name (invisible marks such as right-to-left marks or
the joiner inside some emoji, control characters), and stops at 80 characters. If Firefox still
refuses a name, the recording is saved as `YYYY-MM-DD_HH-mm_recording.webm` and Diagnostics say
why. A recording stopped before anything was recorded (Record and Stop at once) leaves no file:
the popup lists it as failed with "nothing was recorded", and Diagnostics say so too.
With video ≈ 1.1 GB per hour; audio-only (Opus 64 kbps) ≈ 30 MB per hour. Seekable. The template
tokens are `{date} {time} {title} {code} {provider}`.

## Meeting notes (coming)

In progress: every recording will get a Markdown file with the same name next to it
(`Weekly sync.webm` and `Weekly sync.md`). It will say what the meeting was, who took part, and
what happened: the recording started, paused and stopped, people joined and left, someone shared
their screen. Every event will carry its position in the recording, so a reader can seek to it.
The file will hold one machine-readable block with a versioned, documented format, so an AI
assistant or another tool can parse it. A setting will choose whether the notes name the
participants.

Follow the work in the
[`meeting-notes` issues](https://github.com/zenfully-org/zen-recorder/issues?q=label%3Ameeting-notes).

## Privacy

- Zen Recorder records the audio and video of the meetings you take part in, on the services
  above, and saves them as files in your Downloads folder.
- While a recording runs, its pieces are kept in the browser's own storage (IndexedDB) so that a
  crash loses nothing. They are deleted once the file is saved. Pieces of a recording whose start
  never reached Zen Recorder cannot become a file; they are deleted a day after the last one
  arrived. The popup's list of recent recordings (file names, sizes, status) stays in the
  extension's storage.
- It sends nothing anywhere: no servers, no accounts, no analytics, no crash reports. The
  extension's manifest declares that it collects no data.
- The Diagnostics log stays in the browser. The popup's **Diagnostics** button copies it to your
  clipboard only when you press it. The log names your recordings' files, and so their meeting
  titles: read it before you share it.
- Asking the other people in the call for their consent is up to you (see the note under
  [Per service](#per-service)).

The [privacy policy](https://zenfully-org.github.io/zen-recorder/privacy.html) says all of this in
full (its source is [`docs/store/privacy.md`](docs/store/privacy.md)).

## How it works

Firefox gives extensions no way to capture a tab's audio: it has no `tabCapture`, and
`getDisplayMedia` records no audio and asks for a click every time. So Zen Recorder records inside
the meeting page:

1. A script in the page hooks the meeting's own media: the other participants' audio from WebRTC
   (on Zoom, from the audio element the client plays), and your microphone from `getUserMedia`.
2. It mixes the audio, draws the video tiles onto a canvas, and encodes both (VP9 and Opus through
   WebCodecs, written as WebM by [Mediabunny](https://github.com/Vanilagy/mediabunny)). With video
   off, or without WebCodecs, it records the audio alone with `MediaRecorder`.
3. Every few seconds (3 by default) it hands the next piece of the file to the extension's
   background page, which stores it in IndexedDB.
4. When the call ends, the background page joins the pieces, adds the duration and the seek
   index, and saves the file through the browser's downloads.

Each meeting service is a small "provider" behind one contract: it says when you are in a call,
who else is there and where the video tiles are. Everything else is shared by all three.

## Develop

The commands CI runs on every pull request:

```bash
pnpm install          # Node 22.14 or later, pnpm through corepack
pnpm build            # the extension, in .output/firefox-mv3
pnpm check            # Biome and the project's conventions
pnpm compile          # TypeScript, strict, no output
pnpm test:coverage    # unit tests, with 100 % coverage of src/lib
pnpm test:e2e         # the end-to-end run in Firefox, one CI job per service
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest: setting up on Linux, macOS or Windows, the rules
a change follows, the Firefox end-to-end run, and loading a development build in your browser.
[docs/architecture.md](docs/architecture.md) shows how the code fits together. Report a security
problem privately, as [SECURITY.md](SECURITY.md) describes.

## Licence

[MIT](LICENSE), copyright the Zen Recorder contributors. The libraries bundled into the extension
keep their own licences: all are permissive (MIT, ISC, Apache-2.0, 0BSD) except
[Mediabunny](https://github.com/Vanilagy/mediabunny), which writes the WebM files and is under the
Mozilla Public License 2.0 (its source is at that link). The extension carries the project's
`LICENSE` and a `THIRD-PARTY-NOTICES.md` that names every library it bundles, with its version and
licence text. A library the extension bundles must be under a permissive licence or MPL-2.0, never
GPL, LGPL or AGPL, and the build fails on any other.
