# Architecture

This page shows how Zen Recorder turns a meeting into a file, and where each part lives in the
code. It is for people who change the code; the README's "How it works" is the short version for
users. The rules the code follows are in [development-rules.md](development-rules.md).

## Why the recorder runs inside the meeting page

Firefox gives extensions no way to capture a tab's audio. It has no `tabCapture`, and
`getDisplayMedia` records no tab audio and asks for a click every time. So Zen Recorder records
from inside the meeting page: a script in the page's own JavaScript world hooks the media the
meeting already has (the other participants' audio, your microphone, the video tiles on screen).

That choice shapes everything else. The recorder shares the page's main thread with the meeting
app, it can outlive the extension that injected it, and it must hand the file to the extension
piece by piece in case the tab dies. It also runs under the page's Content Security Policy, in
plain view of the page: an `eval` the policy refuses raises an event the page can listen to, and
a report the policy sends to the service. So the recorder builds no code from strings. zod, which
would, is put in its interpreted mode before anything else in every bundle
(`src/wiring/configure-zod.ts`). Nor does the recorder keep anything on the page's window, where
the page's scripts could read and change it: zod's settings stay inside each bundle (a build
plugin, `scripts/build/create-private-zod-globals-plugin.ts`), and a recorder script injected again
after an extension update finds the running one through an event it answers
(`src/lib/page/claim-page-session.ts`), not through a name the page could look up. The recorder
and the bridge talk over a `MessagePort` the bridge hands the recorder in an event the recorder
stops before any listener of the page (`src/lib/page/create-page-link.ts`). While the recorder has
a bridge, a page script that connects too gets nothing: the recorder keeps the bridge that still
answers it.

## The four parts

| Part | Starts in | Runs in | Job |
| --- | --- | --- | --- |
| Recorder | `src/entrypoints/<service>-hook.content.ts` → `src/wiring/run-page-recorder.ts` → `src/lib/page/create-page-session.ts` | the meeting page's own world (`MAIN`), from `document_start` | Hooks `RTCPeerConnection` and `getUserMedia`, mixes the audio, draws the video tiles, encodes, and runs the recording lifecycle. |
| Bridge | `src/entrypoints/<service>.content.ts` → `src/wiring/run-bridge.ts` → `src/lib/bridge/create-bridge.ts` | the content-script world of the same page (`ISOLATED`) | Checks every message from the page, relays chunks and state to the background over a Port, draws the status card in a closed shadow root (the page's scripts share the DOM, and cannot read it), and passes the settings in. |
| Background | `src/entrypoints/background.ts` → `src/lib/background/` | the extension's event page | Stores chunks and meeting events in IndexedDB, turns the chunks into a file and saves it, recovers recordings a crash left behind, and serves the badge, the shortcut and the popup. |
| Popup and Options | `src/entrypoints/popup/`, `src/entrypoints/options/` | extension pages (React and shadcn/ui) | Status, Record/Pause/Stop, the list of recent recordings, Diagnostics, settings. |

The entrypoints only wire modules together. The logic lives in `src/lib`, one function per file:

| Folder | What it holds |
| --- | --- |
| `providers/` | The contract every meeting service implements, and one folder per service (`meet/`, `zoom/`, `teams/`). |
| `capture/` | Hooks for WebRTC, `getUserMedia` and audio that plays through media elements. |
| `page/` | The page session, the lifecycle reducer, the mixer, the audio tap and clocks, the encoders, the meeting events (`createNotesTracker`), and the senders that deliver chunks and events until acked (`createAckedSender`). |
| `video/` | Finding, laying out and drawing the video tiles; the adaptive frame rate. |
| `bridge/`, `messaging/`, `protocol/` | The bridge, the Port to the background, and the zod parsers for every message. |
| `background/`, `storage/`, `finalize/` | The recording manager, the IndexedDB chunk store and event store (`openEventStore`), building and saving the file, and writing its meeting notes (`createNotesWriter`). |
| `notes/` | The meeting notes format: its schema, the builder from what the background stored, the renderer and the parser. |
| `settings/`, `ui/`, `project/` | Settings, the status card on the meeting page (and where it was left, per service), and the project's name and notice. |

Tests sit next to the code. Fakes of browser APIs are in `src/test/fakes/`, the fake meeting pages
in `src/test/fixtures/`. The scripts for the end-to-end run, the benchmarks and the setup are in
`scripts/`.

## From the meeting to a file

```
meeting page, MAIN world
  remote audio (WebRTC, or a media element) ─┐
  your microphone (a clone of the track) ────┴→ mixer (AudioContext) → audio tap (AudioWorklet)
  the service's video tiles → compositor (a 1920×1080 canvas) → VideoFrame             │
                    └──────────────→ WebCodecs (VP9, Opus) → Mediabunny (WebM) ←───────┘
                                       ↓ a chunk every few seconds, resent until acked
      ↓ over a private MessagePort the bridge handed the recorder, never the page's window
meeting page, ISOLATED world: the bridge checks it (zod) → runtime Port
                                       ↓
background: IndexedDB, one row per chunk → ack
  at the end: join the chunks in order → remux (duration, seek index) → downloads.download
```

The file's timeline is the audio graph's clock. Every audio buffer carries the graph position where
it was captured, and goes there in the file, however late a busy page delivers it. A page busy
with long tasks does not fall behind: Firefox hands it the audio worklet's messages one per task,
so once a few of them are waiting the worklet keeps its buffers and sends them together in the
next message, and the encoder writes the audio that waits for its turn as one sample (only audio
that follows on in the file is joined). Silence goes only where the graph captured nothing. Firefox starts a window's audio graph only once it has
opened the audio device, which can take more than a second, so a meeting page keeps a silent
`AudioContext` at the mixer's sample rate open before anything records, as soon as the browser
lets the page play audio. The mixer then joins a graph that already runs, and the recording has
audio from its first moment. Video frames are stamped with the same clock, so the two stay
in step. The WebM muxer rounds every video timestamp to the track's frame rate (to 1/15 s at
15 fps), so each frame goes into the slot of the moment it was drawn, or into the next free one
when an earlier frame took that slot: no two frames share a timestamp, and other tools read the
frame rate from the file. Without WebCodecs (a profile with `privacy.resistFingerprinting`), or
after the video fails, the recorder falls back to `MediaRecorder` and records audio only.

Each encoder also says where the recording is in its file: `Encoder.mediaTimeMs()`, the position a
player shows for this moment of the meeting. A pause is cut out of the file, so the position stands
still while paused, and it stays where it was at the stop. The WebCodecs encoder reads the clock its
video frames are stamped with. `MediaRecorder` stamps its Opus audio by the frames its stream
carries, so the recorder reads the mixer's `AudioContext` clock there, not the wall clock. A
suspended context is the one exception: its clock stands still, but Firefox goes on writing the
file with silence, so the mixer adds the wall time of every span its context was not running.
The end of a recording carries the file's length by that clock (`mediaDurationMs`), and the remux
reports how far it moved every timestamp to start the saved file at its first packet
(`startOffsetMs`). Chunk timestamps are wall time and say neither.

The recorder also notes what happens in the meeting, for the notes that go beside the file. For
now that is when each recording started and stopped, and why it stopped. A recording's events are
numbered from 0 (`seq`) and stamped with the wall time and with `Encoder.mediaTimeMs()` in whole
milliseconds, so each one points into the file. They travel apart from the chunks, on a queue of
their own: a paused recording writes no chunks, and an event the background cannot read must never
hold a chunk back. The page sends them in batches (2 seconds after the first one waiting, at once
with 50 waiting or with the recording's stop among them, at most 200 at a time), each batch again
until the background acks it, and the background stores each `seq` once, in a database of its
own, `zen-recorder-events`. Not in the recordings database: a new store there needs a new database
version, and an older build of the extension installed over this one could then open neither, and
record nothing.

```
page: notes tracker (seq, wall time, place in the file) → events queue, resent until acked
  → bridge: checks the batch (zod), answers itself a batch it cannot read → runtime Port
  → background: zen-recorder-events, one row per recording and seq → ack
```

The file's colour tag tells a player how the canvas's RGB pixels became YUV: the matrix and the
range it needs to turn them back. Firefox's video encoder converts with BT.601 at limited range (up
to at least Firefox 160) but reports BT.709 whatever it did
([Bugzilla 2057760](https://bugzilla.mozilla.org/show_bug.cgi?id=2057760)), so the recorder ignores
the report and tags the video BT.601 at limited range, in the WebM header and, for VP9, in every
keyframe. The primaries and the transfer stay BT.709's, those of the sRGB canvas. The remux at the
end keeps the tag. A page cannot ask Firefox which matrix it used, and cannot measure it either:
the browser's decoder hands frames back as RGB. So an end-to-end scenario paints colour bars, decodes
a saved frame as tagged and checks the colours; CI runs it on the latest Firefox release, and when a
release converts otherwise, it fails and names the matrix that does fit.

Everything in the recorder runs on the meeting page's main thread, which the meeting app needs too.
Meet's Trusted Types policy blocks Workers; only the audio tap leaves the main thread, as an
`AudioWorklet`. So the video path keeps its work small: it skips a frame when no tile changed, it
snapshots a shared canvas once per frame, and it lowers the frame rate (15, 7.5 or 5 fps) when the
page gets busy, then raises it again.

A canvas that a worker paints (Zoom's tiles) is the one source that can freeze the page: Firefox
answers a snapshot of it by asking that worker and blocking the main thread until it replies, for up
to 10 seconds. When one snapshot blocks for more than 250 ms, the recorder leaves that canvas alone
and draws its tiles as placeholders for 5 seconds, then tries again. While the worker stays busy,
the wait doubles each time, up to a minute, so a stuck worker freezes the page about once a minute
instead of at every frame. Diagnostics say when a canvas is held back and when it is quick again.

The audio tap's worklet loads its module from a `blob:` URL where the page allows it (Meet, Zoom).
Teams' Content Security Policy refuses scripts from `blob:` and `data:` URLs, so there the module
comes from a file of the extension, which the manifest makes web-accessible to the three services'
sites only. Firefox checks no page's policy for a `moz-extension:` URL (`SubjectToCSP` in Gecko's
`dom/security/nsCSPService.cpp` exempts every scheme flagged `URI_IS_LOCAL_RESOURCE`). That URL
names the extension's per-install id, the same on every site and in every session, and Firefox
keeps it from pages (the recorder's frames show as `<anonymous code>` in a page's stack traces).
So the bridge hands it to the recorder at `document_start` only, in an event dispatched before
any script of the page exists, and the recorder loads its modules through the
`AudioWorklet.prototype.addModule` it found then, which a page cannot replace. The file is named
after a hash of the module's source: a recorder that outlived an update of the extension finds no
file under its old name, and falls back. Without a worklet, a `ScriptProcessorNode` records on the
main thread.

## Meeting services

Each service (Google Meet, Zoom, Microsoft Teams) is a "provider" behind one contract,
`src/lib/providers/types.ts`. Everything outside `src/lib/providers/<service>/` is shared.

| Piece | Answers |
| --- | --- |
| `ProviderDescriptor` | The static facts: id, name, the hosts it runs on, where its fake page lives. The build, the popup and the fixture server read them. |
| `meetingUrl(meetingId)` | On the descriptor: the meeting's link built from its id alone, for the meeting notes, or `null` where the service has none (Teams' links need more than the id). Built from the id so nothing of the page's own address (a passcode, your name) reaches a file. |
| `readMeeting(page)` | Is this page a meeting, what is it called, has the user been let in (not a pre-join screen or a lobby), and how many others are there. Read every second, so it must be cheap and never throw. |
| `installCapture(window, listener)` | Installs the media hooks at `document_start` and reports remote audio, the microphone and whether the call is connected. It installs in a browser where WebRTC is switched off too, which has no `RTCPeerConnection`: the WebRTC hook then finds no connection, and the microphone is still heard. |
| `readMicMuted(document)` | Optional: the mute state the page shows, for services that do not mute the microphone track. |
| `findTiles(root)` | The video tiles to draw, with their position, name and kind, in the order the page paints them: where two overlap, the one on top comes later (document order, for tiles stacked as siblings). The recording draws them in that order. Called for every frame, so it caches nothing. |
| `readPresence(page)` | Who is in the call, who shares a screen and how the page shows the user's microphone, for the meeting notes; null when it cannot tell (not a meeting, a lobby, a call the page no longer shows, a call the user is leaving). The recording does not depend on it. |
| `notesCapabilities` | The most `readPresence` can observe on the service: a count of the people, a list of everyone (`roster`), the user's own tile (`self`), that someone shares (`share`), and who (`shareBy`). |

A presence reading keeps to these rules on every service, and the contract tests check them:

- It never throws, keeps nothing between two calls, measures no layout and walks the page once.
- A screen share is never a person: someone's camera and their share are one participant.
- A person's `key` is the most stable thing the page offers: a service id, else
  `name:<display name>` (`#2`, `#3` for a second and third person of one name). Never a media slot
  or an id the page gives each element it mounts, so a key survives the page showing the person
  again and their camera going off.
- A reading from the stage (`source: 'stage'`, the people on screen) never proves that someone
  left: layouts, paging and a hidden tab show fewer.
- `count` counts the user, and agrees with `readMeeting`: `count - 1` is the number of others.
- It never states more than `notesCapabilities` allows: no count, list, user's tile, share or
  sharer the service cannot show. A share it cannot see is `unknown`, not `none`.
- `selfMic` says `not-connected` only where the page shows it (Zoom's "Join audio").

| Service | `readPresence` reads | Capabilities |
| --- | --- | --- |
| Google Meet | every tile by its participant id (a camera and a presentation are one person), the user by the self view's controls, the count from the people badge | `count`, `self` |
| Zoom | every stage tile by its name (no tile carries an id while its camera is off), the count from the participant counter without the waiting room, the sharer from the share's user id, the microphone from the audio button | `count`, `share`, `shareBy` |
| Microsoft Teams | every stage tile by its name, the user as the one camera tile without the "speaking" outline, the count from the People badge, the sharer from the share tile, the microphone from the toolbar | `count`, `self`, `share`, `shareBy` |

A provider is done when it passes the shared contract tests (`describeProviderContract`), has a
fake page that every end-to-end scenario runs against, and has been tried on the real service. To
add one, follow an existing provider: the descriptor, the provider, its two entrypoints, the fake
page and its entry in `scripts/e2e/targets.ts`.

## The recording lifecycle

A pure reducer, `reduceLifecycle(state, event, config)`, decides when to record; the page session
carries out the effects it returns. The statuses are `idle → waiting → recording ⇄ paused → stopping`.

- **Start** when auto-record is on, the user has been let into the call, and someone else is there
  (or, with Options → "Start recording" set to "as soon as the call is connected", once the call
  connects). Record works by hand on any meeting page.
- **Stop** on leaving the meeting, on Stop, when the page goes away, or when every connection has
  been dead for 5 seconds. A connection the page closes fires no event, so the WebRTC hook reads
  the connections every 250 ms. The session wakes the reducer when the 5 seconds run out, rather
  than waiting for its next one-second tick.
- **Encoder failure:** the recording so far is saved and a new one starts in the same status, so a
  pause stays a pause. After four failures in a row it stops trying until the user presses Record,
  and the tab's snapshot says so (`encoderGaveUp`): the status card and the popup show "Recording
  failed" instead of looking ready to record.
  The new one starts at once, even while the extension has not taken the failed one's chunks yet,
  and it is audio only when the video failed.
- **A full backlog:** the extension took none of the page's chunks until it held its limit
  (64 MiB for recordings with video, 64 MiB for audio-only ones, the stopped recordings' chunks
  included). The recording stops, keeping every chunk, and a new one starts in the same status:
  at once and audio only when the full one had video, otherwise once the extension has taken the
  page's audio-only chunks. The page's snapshot says which (`backlogFull`), so the tab's status
  card shows it for as long as it lasts. Once the extension has taken the recording with video
  that filled it, and keeps up with the audio-only one, that one stops too and the next recording
  has video again; only a video pipeline that failed keeps the video off for the rest of the
  meeting.

## Never losing a meeting

These rules exist because breaking each one lost a recording once:

- **Chunks concatenate into the file.** They are never reordered, dropped or renumbered. The first
  one carries the file header, so a recording without it, or without a single audio or video
  sample, is refused rather than saved as a file no player opens. The recording keeps its chunks
  and says why it was refused (`refusal`, next to the reason in words), so the popup offers
  Remove rather than a retry that would refuse again.
- **Messages that matter are acked.** The page sends each chunk, and the end of a recording, again
  until the background has stored it. The background acks a chunk only once it is stored. A
  request between the page and the bridge waits 30 seconds for its answer at most, and a notice
  that needs no answer (a log line, a snapshot) waits for none, so a bridge that is gone for good
  leaves nothing waiting in the page. A chunk whose ack only came late reaches the background
  twice; it is stored once and counted once, because the page sends a recording's chunks in order
  and one at a time, so a sequence number below the count was counted already. The page's log
  lines are acked between the bridge and the background too: the bridge numbers each line, notes
  when it got it, and sends it again until the background acks it, so a line written while the
  background restarted is not lost; the background writes each number once, under that time.
- **The page holds only so much, and drops nothing to keep to it.** The chunks the extension has
  not taken yet stay in the meeting page's memory, about 20 MB a minute with video. The page holds
  at most 64 MiB of them for recordings with video and 64 MiB for audio-only ones, counted over
  all its recordings: the running one and those stopped while the extension took nothing, whose
  chunks wait beside it. Past that, the page stops the recording rather than the chunks: a
  recording with video goes on as audio only, 40 times smaller, until the extension has taken the
  video and keeps up again, and one without stops until the extension has taken the page's
  audio-only chunks. Any other stop (an encoder failure, Stop then
  Record, a new meeting in the same tab) starts the next recording at once, so an outage never
  keeps a meeting out of the files.
- **The page is the source of truth while the tab lives.** The background never finalizes a
  recording that still receives chunks, or one a page still claims: each page names the recording
  it writes and the stopped ones whose chunks it has not handed over yet, so a background that
  restarts during an outage leaves them to the page instead of saving them without those chunks.
- **The recorder survives an extension update.** The script in the page keeps running, so there is
  one session per page, it announces its recording again to the new bridge, and the background
  ignores late messages for recordings it already saved.
- **A start the store refused is kept.** The page announces a recording once, and again only to
  a new bridge. When the background cannot store the announcement (a full disk), it keeps it and
  stores it with the recording's next chunk or its end. An end that still cannot be stored is
  not confirmed, so the page sends it again, and Diagnostics say why no file is saved yet. An
  announcement the bridge sends while its connection to the background is down (Firefox
  restarting the background) never arrives at all, so every end carries the recording's
  announcement too, from the page or from the bridge, and the background stores it from there
  when it has none.
- **A failure the person can fix reaches them in time.** When the background cannot store a chunk
  or an end (a full disk, or a database the browser closed), the tab that sent it shows an error
  toast saying what happened and what to do, while the page holds the recording. It is shown
  once: again only after everything of that tab that failed has been stored, so a disk that stays
  full does not toast at every send. Only that tab: another meeting tab hears nothing. The same
  goes for what the background says about a recording later (its file saved, a save that failed,
  little storage left): it reaches the tab the recording came from and no other. A tab that
  stopped no longer names its recording, so the background remembers the tab from the
  recording's start, chunks and end. What follows minutes later, when the page holds its limit, only the page knows, so its snapshot says
  it: "audio only" while the video that filled it waits, "waiting" while nothing records. The
  status card shows it in amber words until it is over, not in a toast that leaves after 8
  seconds, and a toast tells it each time it gets worse. The popup's card for the tab says it in
  the same words, read from the same snapshot, for someone who turned the status card off.
- **A page that goes away still ends its recording, and keeps its last seconds.** A page being
  unloaded runs no later task, so nothing it posts after `pagehide` arrives. Inside its own
  `pagehide`, the recorder flushes the video encoder and hands the bridge what it still holds (the
  chunks the background has not confirmed, and each recording's end) by a DOM event, which the
  bridge receives in the same task and relays on its Port, in order, sending nothing twice. When a
  closed tab's content process shuts down with it, Firefox can stop the page's script once, at any
  point, so the bridge asks for the handover again from its own `pagehide` listener and the
  recorder finishes whatever the first call did not. Then the bridge sends the end of any
  recording still without one, behind the chunks it relayed (a recorder from before an update
  hands nothing over). The file is saved at once under its own name and reaches the moment the
  page went away; with audio alone it can still miss the last few seconds, which the browser's
  recorder hands out only in a later task. On a busy machine Firefox can lose what the bridge
  posts when the tab closes; the browser still reports the closed tab (`tabs.onRemoved`), and the
  background then ends the recording itself, once it has handled the messages the tab sent before
  (`src/lib/background/create-lost-tabs.ts`).
- **Meeting events never hold a recording up.** The page sends events only to a bridge whose
  configuration says it takes them (`eventsProtocol`): an older bridge answers no message it does
  not know, and the page would send to it forever. The bridge answers a batch it cannot read
  itself, and never fails it for what it holds. A stop waits for its recording's events at most 5
  seconds, and only its end waits: the next recording starts at once. The end says how many events
  the background acked, how many the page dropped below that, and how many it still holds; events
  that arrive after the end are stored until the recording is saved. The page queues at most
  10 000 events, and past that drops the oldest one that is not a start or a stop; the next batch
  names the numbers it dropped. A page that goes away stamps the stop and hands its end over at
  once, with the counts so far: the events it still holds never leave, and the end, and so the
  notes, say how many. A recording started while the notes are off gets no events at all. Removing a recording removes its events, and the recovery pass
  deletes the events of a recording the background never got the start of, once none has arrived
  for a day.
- **A crashed tab is recovered.** When a tab's Port drops without an end and the tab was not
  closed, the background waits for that tab's queued messages, then 10 seconds, then saves what
  it has with "(recovered)" in the name. After a browser crash, a pass 30 seconds after the next start does the same. When marking
  the recording interrupted fails (a full disk), it stays `recording`; once no tab claims it and
  its last chunk is a minute old it is abandoned, and the popup's Retry save saves it the way the
  pass would, never earlier. A recovered recording stores `recovered` when its save starts, so a
  save that fails and is retried, or one finished by the next pass, is still named "(recovered)".
  The same pass
  deletes the chunks of a recording whose start never reached the background, once none has
  arrived for a day: without the start, the background has no name or format for them.
- **One save at a time.** Firefox picks a free file name only against files already on disk, so two
  downloads of the same new name at once lose one. Every save goes through one queue.
- **Nothing slow blocks a tab's messages, and one failure stops nothing.** Saving a long recording
  takes seconds; it runs outside the tab's message queue. Each message's error is caught and
  logged, and the next message runs. A call the background starts without waiting for it (the
  settings sent to a tab that connects, the toolbar badge, the keyboard shortcut) catches its own
  failure and writes it to Diagnostics, so nothing fails without a word.

## Saving the file

When a recording ends, `finalizeRecording`:

1. joins the stored chunks in order into one `Blob` (backed by files, so no large copy in memory);
2. remuxes the WebM with Mediabunny, without re-encoding, to add the duration and the seek index;
   if that fails it saves the joined chunks as they are;
3. builds the file name from the template, keeping only characters Firefox accepts in a name; a
   subfolder whose name ends in `.lnk`, `.local`, `.url`, `.scf` or `.desktop` gets `_` for its
   last dot, because Firefox would add `.download` to it and then refuse the path;
4. saves it with `downloads.download` through the save queue, and waits until the download has
   settled;
5. deletes the chunks and marks the recording saved, with the file's absolute path.

The popup's Show file finds the download by that path when clicked, never by the id the download
had: Firefox numbers its downloads anew in every browser session and lists no finished download
after a restart, so an old id names another download, or none. When Firefox no longer lists the
file, Show file opens the download folder and says where the file was saved.

A recording above 64 MB is remuxed through a scratch file in the origin-private file system, so
the event page never holds the whole file in memory. Without that file system, a recording above
400 MB is saved as it is rather than risk running out of memory.

## Meeting notes

Each saved recording gets a Markdown file of notes next to it: what the meeting was, who took
part and what happened when, every event with its position in the file. The format is a versioned
interface, `zen-recorder/meeting-notes` 1.0, documented in
[meeting-notes-format.md](meeting-notes-format.md) with a JSON Schema,
[meeting-notes.schema.json](meeting-notes.schema.json). Its code is in `src/lib/notes/`, pure
functions that touch no browser API:

- `parseMeetingNotes` holds the format's zod schema, the executable definition, and reads a notes
  file's data block back. `pnpm notes:schema` writes the JSON Schema from it, and a test fails
  while the two differ.
- `buildMeetingNotes` turns what the background stores about a recording (its facts, its events,
  the saved file) into a notes document: times in the recording's time zone, positions in the
  saved file, names only when they are collected, and what is missing and why.
- `renderMeetingNotes` writes a document as a file: YAML front matter for note apps, a short human
  summary, a participants table and a timeline, and the document itself as a `json` block under
  `## Data`, one event per line.

Two golden files in `src/test/fixtures/` are compared with the renderer byte for byte, never as
snapshots: the format's example, which the format doc shows too, and one that holds every event
type. A change to what a notes file says changes them, the format doc and the schema in the same
pull request.

`createNotesWriter` (`src/lib/background/`) writes them. A recording's save marks its notes
`pending` and stores what they are built from (the remux's start offset, whether it remuxed, the
raw copy's name); the save's `onSaved` then queues the notes on the writer's own queue, one
recording at a time and outside every tab's message queue. For one recording it reads the stored
metadata through `parseRecordingMeta` (a recording from an older version gets that version's
defaults), loads its meeting events, builds and renders the notes in the background (whose time
zone the notes keep: the page's can be UTC under fingerprinting protection), and saves them
through the save queue under the saved recording's own name with `.md`. The name comes from the
saved file, since Firefox names a second file of one name `X(1).webm`. The meeting's link comes
from the provider's `meetingUrl`.

- **Setting `off`:** no file, the notes are `skipped` and the events deleted. `withoutNames` drops
  every name.
- **A notes save that fails** leaves the recording saved: the notes are `failed`, the events kept,
  and one Diagnostics line says why. No toast: the recording, which is what matters, is on disk.
  The notes save gives up after 30 seconds and cancels its download. The save queue may then
  start the next file while that download could still finish, which is safe because the next
  file has another name, and the cancel keeps a late `.md` from landing.
- **A background that stops** between the two saves leaves the notes `pending`: the recovery pass
  at the next start writes every saved recording's notes that are `pending`, or `failed` fewer
  than three times. Retry save on a saved recording writes only its notes.
- **The events are deleted** once the notes are written or skipped; the recovery pass deletes the
  ones a failed delete left.

## Tests

- **Unit tests** (`pnpm test`): Vitest with happy-dom. Browser APIs are faked; Mediabunny runs for
  real with fake encoders.
- **End-to-end run** (`pnpm test:e2e`): Puppeteer drives a real Firefox over WebDriver BiDi,
  installs a test build of the extension and opens a fake page of each service
  (`src/test/fixtures/`, served by `scripts/fixture-server.ts`). Most scenarios in
  `scripts/e2e/scenarios.ts` record a call and check the saved file with `ffprobe` and `ffmpeg`.
  The audio measures cut the seconds they measure from the decoded audio: asked to seek its input,
  ffmpeg starts at a video key frame and skips the audio before a late first video frame. The run
  checks that on a small file before its first scenario.
  The test build (`pnpm build:e2e`) adds debug probes and fault injection that a release build
  does not have: they sit behind `import.meta.env.WXT_E2E === '1'`, a constant the bundler
  replaces, in the modules `scripts/release/list-test-build-modules.ts` names, and a release build
  fails when it ships code of one. The test build also hands the status card's closed shadow root
  to the fake page as `window.__zenRecorderCard`; the run reads and clicks the card through the
  page's `__fixture.cardRoot()`.
  Every fake page lets a scenario add and remove people (camera on or off), start and stop a
  screen share by any of them, and share the user's own screen from a click on its
  `#share-screen` button (`FixtureApi` in `scripts/e2e/harness.ts`); the test build's
  `__zenRecorderPage.debug().presence` is the provider's reading of the page, each name replaced
  by its length. Firefox's fake media has no screen to share (`getDisplayMedia` rejects with
  `NotFoundError`, Firefox 155), so the test build answers it with a picture it draws, and only
  from a click, as Firefox does.
  Opened with `observe` in its URL, a fake page's first script records what a meeting page could
  see of the recorder (`src/test/fixtures/page-observer.js`): calls of the page's own
  `addModule`, and the extension's `moz-extension:` id in its messages, events, resource timing,
  window properties or DOM.
  The fixture server sends every fake page a report-only Content Security Policy that forbids
  `eval` and requires Trusted Types, and keeps what it reports at `/csp-reports`: a policy in a
  `<meta>` tag would apply only after the extension's scripts ran at document start. A scenario
  checks that a recording leaves no report of code built from a string.
  A busy machine is not a stalled tab: the recorder lowers its frame rate under load, so a check
  that counts video frames judges each phase of a call against the rate the recorder aimed for,
  and excuses a shortfall only where the recorder's own statistics say the page was overloaded
  (`scripts/e2e/judge-frame-span.ts`).
  The keyboard shortcut is pressed in the browser window, where Firefox handles an extension's
  shortcuts and where keys sent to a page never arrive: the run starts Firefox with
  `--remote-allow-system-access`, and `scripts/e2e/press-shortcut.ts` sends trusted key events
  there over the run's WebDriver BiDi session.
- **Benchmarks** (`pnpm bench`, `pnpm bench:primitives`): what a recording costs the page per
  service, and what single browser operations cost on this machine.
- **CI** (`.github/workflows/ci.yml`): every pull request, every merge-queue run and every push to
  `main` runs the gate and the reproducible-build check; the end-to-end run, one job per service,
  runs for the services a change touches (`scripts/ci/decide-e2e-scope.ts`), and in full every
  night and by hand. Every `run` step goes
  through `scripts/ci/run-step.ts`, which records its command, exit status, time and output; the
  last step of each job (`scripts/ci/write-report.ts`) reads the failed step's output with a small
  parser per tool (Vitest, tsc, Biome, the conventions, the quality gates, coverage, the
  end-to-end run) and writes the job's summary, annotations on the lines the errors name, and
  `ci-report.json`, a versioned shape for tools (CONTRIBUTING.md, "When CI fails"). The quality
  gates pass a value better than its baseline and list it; the scheduled **Tight baselines**
  workflow (`.github/workflows/quality-baseline.yml`, weekly, read-only) runs them with
  `--strict`, which fails on that slack, and its report lists what a pull request with
  `pnpm check:quality --update-baseline` would lower.

## Releases

A tag `v<version>` runs `.github/workflows/release.yml`: the gate, a build, a draft GitHub
Release, signing on addons.mozilla.org once the maintainer approves, then the published release
and the update manifest. The repository variable `AMO_CHANNEL` picks the channel
addons.mozilla.org signs on, and with it the build:

- `unlisted` (the default): the self-distributed build (`ZEN_RECORDER_CHANNEL=self`), the only
  one whose `manifest.json` names an update manifest (`scripts/release/get-gecko-settings.ts`).
  Installed copies read that file, `updates.json` on the project's GitHub Pages site, once a day.
- `listed`: the build without the variable, which names none, as addons.mozilla.org requires
  there. The GitHub Release offers the file addons.mozilla.org serves, and Firefox updates it from
  addons.mozilla.org.

addons.mozilla.org keeps one version number per add-on across both channels, so once the add-on
is listed, every release goes through the listed channel. Every release adds its entry to
`updates.json`, listed ones too: a copy installed from a GitHub Release before the listing
updates to the listed XPI and from then on updates from addons.mozilla.org. The scripts in
`scripts/release/` check the signed XPI against its channel and write `updates.json`;
CONTRIBUTING's "The changelog and releases" has the steps.

Every build (`pnpm build`, and the one `pnpm zip` runs) ends in `scripts/notices/`: from the
modules its chunks hold, and from what the stylesheet imports, it lists the packages whose code the
extension bundles, checks that each one's licence is on the project's list and comes with a
licence text, and writes `LICENSE` and `THIRD-PARTY-NOTICES.md` into the extension. A package
outside the list fails the build, so CI fails too, and the release refuses an XPI without the two
files.

The XPI rebuilds byte for byte from its sources zip, which addons.mozilla.org's reviewers check
with every submission. `scripts/release/check-reproducible-build.sh` does what they do (unpack
the sources in an empty folder, run the two commands of `README-REVIEWERS.md`, compare the build
with the XPI), in CI on every change and in the release on the build it signs. The listed build is
the one without `ZEN_RECORDER_CHANNEL`; its texts, privacy policy and permission justifications
are in `docs/store/`.

## Known limits

- The video shows the meeting's tiles and shared screen, not the chat, captions or reactions.
- Each participant's audio cannot be separated: the services mix speakers before they reach the
  page.
- A profile with `privacy.resistFingerprinting` hides WebCodecs, so it records audio only.
- A browser that is killed loses up to the last chunk interval (3 seconds by default).
- A meeting page can tell that it is recorded: its media APIs are hooked, and a script that
  knows the recorder's event names can dispatch one and see it answered.
- A script of the page that keeps connecting to the recorder could take the place of the
  extension's content script in the seconds after an extension update, when the old one is gone
  and before the recorder has checked the new one.
