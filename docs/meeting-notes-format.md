# Meeting notes format

Zen Recorder saves a Markdown file next to every recording: `Weekly sync.webm` gets
`Weekly sync.md`. It says what the meeting was, who took part, and what happened when, and every
event has its wall-clock time **and its position in the saved file**, so a reader can seek to it.

The file is written for an AI assistant first and a person second. An assistant reads the data
block at the end, which is complete, structured and versioned; a person reads the summary and the
timeline above it; note apps (Obsidian, Logseq and the like) index the front matter. Everything
stays on your computer.

This page is the format's definition: `zen-recorder/meeting-notes`, version 1.0. Every notes
file links to it.

- [The three parts](#the-three-parts)
- [File name and encoding](#file-name-and-encoding)
- [Front matter](#front-matter)
- [The data block](#the-data-block)
- [Event types](#event-types)
- [What was not observed](#what-was-not-observed)
- [Versioning](#versioning)
- [Example](#example)
- [Changelog](#changelog)

## The three parts

1. **Front matter**: flat YAML between `---` lines at the very start, for note apps. Derived from
   the data block; it may be shorter (at most 50 names).
2. **The human part**: the title, the day and time, a short summary, `## Participants` (a table)
   and `## Timeline` (a table: local time, position in the file, what happened). English, ISO
   dates, 24-hour times. Related events share a row (a connection lost and restored), and a
   reading of who is in the call is told by the start row and the participants table.
3. **The data block**: under the heading `## Data`, a fenced code block whose info string is
   `json`. It is the complete record, and the one part a program should read. To find it: the
   first fenced block with the info string `json` after the line `## Data`.

`null` always means "not observed or not known", and the `capture` section says why. A state that
never changes (muted for the whole call, a tab in the background from the start) is still
written, in the start event.

The data block's JSON Schema is [meeting-notes.schema.json](meeting-notes.schema.json) (draft
2020-12). It is generated from the format's executable definition,
`src/lib/notes/parse-meeting-notes.ts`, and a test keeps the two equal.

## File name and encoding

- The notes take the name of the saved recording, with `.md` for its extension, in the same
  folder: `2026-10-04_14-03_Weekly product sync(1).webm` gets
  `2026-10-04_14-03_Weekly product sync(1).md`. From the saved name, because Firefox names a
  second file of the same name `X(1).webm`. If an older file already took that name, Firefox
  names the notes `X(1).md`; the notes name their recording inside (`recording` in the front
  matter, `recording.file` in the data block), so the pair can always be matched.
- UTF-8 without a byte order mark, LF line endings, the front matter from the first byte.
- Text from the meeting page (names, titles) is cleaned before it is written: control
  characters, DEL and C1 are dropped (line breaks and tabs become spaces), and so are the
  characters that change how a name reads or hide in it (bidi marks, embeddings, overrides and
  isolates, U+FEFF, U+FFFE, U+FFFF). Zero-width joiners stay, as emoji and many scripts need them.
  Whitespace is collapsed and trimmed.
- In the front matter every string is double-quoted (`JSON.stringify` of the cleaned text), so
  YAML never reads `no`, `null`, `2026-10-04` or `0123` as a boolean, null, a date or a number.
- In the human part, names and titles are escaped: a backslash before
  `` \ ` * _ [ ] < > | # ~ $ & = % ^ ! ``, before a leading `-` or `+`, and before the `.` or
  `)` of a leading `1.` or `2)`. They render as plain text.
- The data block writes one event per line. JSON escapes every line break inside a string, so
  nothing inside the block can close its fence.
- A notes file never holds an absolute path, a link's query or fragment (which can carry a
  passcode), a service's own participant ids, an email address or a phone number beyond what the
  page shows as a name, chat, captions, avatars or the microphone's device name.

## Front matter

| Key | Type | Meaning | When not known |
|---|---|---|---|
| `schema` | string | `"zen-recorder/meeting-notes"` | never |
| `schema_version` | string | `"1.0"` | never |
| `title` | string | The meeting's title at the start, the one in the file name | never empty: the meeting id instead |
| `service` | string | `"Google Meet"`, `"Zoom"`, `"Microsoft Teams"` | never |
| `meeting_id` | string | The service's meeting id (`abc-defg-hij`, a Zoom meeting number) | `"unknown"` |
| `url` | string or `null` | The meeting's link, without query or fragment | `null` |
| `date` | date (`YYYY-MM-DD`, not quoted) | The local date of the start | never |
| `start`, `end` | string | ISO 8601 with the offset, to the second | `end: null` |
| `timezone` | string | The IANA time zone every time is written in | never |
| `recording` | string | The saved recording's file name, without folders | never |
| `duration` | string | `H:MM:SS`, the length of the saved file | `null` |
| `paused` | string | `H:MM:SS` not recorded because the recording was paused | `"0:00:00"` |
| `media` | string | `"video+audio"` or `"audio"` | never |
| `recovered` | boolean | Saved after an unexpected end | never |
| `names` | boolean | Participant names were collected | never |
| `participants` | list of strings | Up to 50 names; absent when `names` is false | `[]` |
| `participants_count` | integer or `null` | People in this file | `null` when not observed |

## The data block

Times are ISO 8601 strings to the second, always with the offset the time zone had at that
instant (`2026-10-25T02:05:00+01:00`), so a change of daylight saving time during a meeting is
right. Durations and positions are integer milliseconds. Keys are written in the order below.

| Path | Type | Meaning | When not known |
|---|---|---|---|
| `schema` | string | `"zen-recorder/meeting-notes"` | never |
| `schemaVersion` | string | `"1.0"` | never |
| `schemaUrl` | string | This page | never |
| `generator.name`, `generator.version` | string | `"zen-recorder"` and the extension's version | never |
| `meeting.service` | string, open | The service: `meet`, `zoom`, `teams` | never |
| `meeting.serviceName` | string | The service's name for people | never |
| `meeting.id` | string | The service's meeting id | `"unknown"` |
| `meeting.title` | string | The title at the start; a later title is a `title-changed` event | never empty |
| `meeting.url` | string or `null` | The meeting's link, without query or fragment | `null` |
| `recording.id` | string | The recording's id | never |
| `recording.file` | string | The saved recording's file name | never |
| `recording.rawFile` | string or `null` | The file name of the raw copy, which Options can keep for debugging | `null` |
| `recording.start` | string | When the recording started | never |
| `recording.end` | string or `null` | When it stopped; for a recording that never stopped (the tab died), the later of its last event and its last saved part | `null` |
| `recording.endEstimated` | boolean | `end` comes from the last event or part, not from a stop | never |
| `recording.timeZone` | string | The IANA time zone every time is written in | never |
| `recording.durationMs` | integer or `null` | The length of the saved file | `null` |
| `recording.pausedMs` | integer | Wall time not recorded because the recording was paused | `0` |
| `recording.mediaOffsetMs` | integer | Already taken off every position: where finalizing moved the file's start | `0` |
| `recording.media` | `"video+audio"` or `"audio"` | The tracks in the file | never |
| `recording.audioOnlyReason` | string, open, or `null` | `setting-off`, `no-encoder`, `pipeline-failed`, `video-failed` | `null` with video |
| `recording.seekable` | boolean | The file was finalized with its duration and cues: a player can seek in it | never |
| `recording.recovered` | boolean | Saved after an unexpected end | never |
| `recording.startCause` | string, open, or `null` | `auto-first-remote`, `auto-on-join`, `manual`, `restart-after-video-failure` | `null` |
| `recording.endReason` | string, open, or `null` | `command`, `left-meeting`, `pagehide`, `connections-lost`, `encoder-error`, `backlog-full`, `recovered` | `null` |
| `recording.continues` | object or `null` | The previous file of the same meeting this one continues: `recordingId`, `file` (or `null`), `gapMs` (wall time between them, or `null`) | `null` |
| `capture.events` | `"complete"`, `"incomplete"` or `"none"` | Whether the timeline holds every event the page saw | never |
| `capture.eventsMissingReason` | string, open, or `null` | Why it does not ([completeness](#completeness)) | `null` when complete |
| `capture.names` | boolean | Names were collected | never |
| `capture.participantSource` | `"roster"`, `"stage"`, `"mixed"` or `"none"` | Where participants came from: the call's full list, or only the people on screen | never |
| `capture.detectionLatencyMs` | integer | How late an event can be stamped after the page showed it ([precision](#precision)) | never |
| `capture.signals` | object | Per signal (`participants`, `joinLeave`, `share`, `shareBy`, `self`, `mic`): `"observed"`, `"partial"` or `"not-available"` | never |
| `capture.coverage[]` | object | Spans of the file where a signal was not observed: `signal`, `reason`, `fromMs`, `toMs`, `fromAt`, `toAt` ([coverage](#coverage)) | `[]` |
| `participants[]` | object | Everyone seen in this file | `[]` |
| `participants[].id` | string | A local id, `p1`, `p2`, …, in the order people were first seen; the same across the files of one meeting | never |
| `participants[].name` | string or `null` | The last name shown | `null` without names, or when the page showed none |
| `participants[].names` | list of strings | Every name shown, in order (renames) | `[]` |
| `participants[].self` | boolean or `null` | `true` for you | `null` when the service cannot tell |
| `participants[].identity` | `"service-id"` or `"display-name"` | How appearances were joined into this id: by the service's own id, or by the name (a guess) | never |
| `participants[].presentAtStart`, `.presentAtEnd` | boolean or `null` | In the call at the start, at the end | `null` without a reading then |
| `participants[].spans[]` | object | The spans of the file they were in: `joinedMs` (`null`: before the file started), `leftMs` (`null`: still there at the end) | `[]` |
| `events[]` | object | The timeline, in `seq` order ([event types](#event-types)) | `[]` |

## Event types

Every event has these fields, in this order, then those of its type:

| Field | Type | Meaning |
|---|---|---|
| `seq` | integer | The order of the timeline: 0, 1, 2, … A gap is an event the page dropped. Events are ordered by `seq`, never by time: the computer's clock can jump. |
| `type` | string | One of the types below. A reader of 1.x ignores a type it does not know. |
| `at` | string | Wall time, when the page saw it |
| `mediaMs` | integer | The position in the saved file, from 0 to `durationMs` |
| `source` | `"page"` or `"background"` | `"background"` only for the end of a recovered recording, which the page never sent |
| `paused` | `true`, or absent | Seen while the recording was paused: `mediaMs` is where the pause cut the file |
| `clamped` | `true`, or absent | Its position was past the end of the file and is placed at the end |

Participants are referred to by their `id`. The types:

| Type | Fields | Meaning |
|---|---|---|
| `recording-started` | `cause`, `media` (`"video"`, `"audio"` or `null`), `audioOnlyReason`, `continuesRecordingId`, `gapMs`, `mic` (`"live"`, `"muted"`, `"not-connected"` or `null`), `tabVisible`, `ownShare` | The recording started, with the states at that moment |
| `recording-paused` | | You paused the recording |
| `recording-resumed` | `pausedMs` | You resumed it; `pausedMs` were not recorded |
| `recording-stopped` | `reason` | The recording stopped (reasons as `recording.endReason`) |
| `roster` | `why` (`"start"`, `"reannounce"`, `"stop"`), `participantSource` (`"roster"`, `"stage"` or `null`), `present` (ids), `count`, `share` (`"none"`, `"unknown"`, `"active"`), `shareBy`, `stale`, `readAt`, `capabilities` | A reading of who is in the call. `stale`: the page no longer answered, so this is the last reading, taken at `readAt`. `capabilities`, on the start reading only, says what the service can show at best: `count`, `roster`, `self`, `share`, `shareBy` (booleans) |
| `participant-joined` | `participant` (or `null`), `count` | Someone joined; `count` is how many are in the call |
| `participant-left` | `participant` (or `null`), `count` | Someone left |
| `participant-renamed` | `participant`, `from` | Someone's name changed from `from` (`null` without names) |
| `participant-count` | `count` | The number of people changed, without a name to tell who |
| `share-started` | `by` (or `null`) | A screen share started |
| `share-stopped` | `by` (or `null`) | A screen share ended |
| `mic` | `state` | Your microphone: `"live"`, `"muted"` or `"not-connected"` |
| `connection-lost` | | Every connection of the call dropped: others' audio may be missing |
| `connection-restored` | `lostMs` | The connection came back after `lostMs` |
| `video-failed` | | The video failed; the meeting goes on in a new file, audio only |
| `title-changed` | `title` | The meeting's title changed |
| `extension-reloaded` | | Zen Recorder was reloaded or updated during the recording, which went on |
| `coverage-lost` | `signal`, `reason` | A signal stopped being observed ([coverage](#coverage)) |
| `coverage-restored` | `signal`, `reason` | It is observed again |

## What was not observed

### Completeness

`capture.events` is `"complete"` when the file holds every event the page numbered, the ones
sent after the recording ended included. Otherwise `capture.eventsMissingReason` gives the first
reason that applies:

| Reason | `capture.events` | Meaning |
|---|---|---|
| `page-session-too-old` | `"none"` | The meeting tab was opened before this version of Zen Recorder and sent no events. Reload the meeting tab to get a timeline next time. |
| `notes-off-during-recording` | `"none"` | Meeting notes were off while the recording ran |
| `recovered` | `"incomplete"` | The recording ended unexpectedly; the timeline ends at its last saved part |
| `events-unsent` | `"incomplete"` | Events the page still held when the recording ended never arrived |
| `events-dropped` | `"incomplete"` | The page dropped events when too many came at once; `capture.coverage` says where |
| `count-mismatch` | `"incomplete"` | Events are missing for a reason Zen Recorder cannot tell |

### Coverage

`capture.coverage` lists the spans of the file where a signal was not reliably observed, with
their positions (`fromMs`, `toMs`) and wall times (`fromAt`, `toAt`):

| `reason` | `signal` | Meaning |
|---|---|---|
| `paused` | `all` | The recording was paused. Not in the file, so `fromMs` equals `toMs`; `fromAt` and `toAt` give when |
| `tab-hidden` | `participants` | The tab was in the background, where the page shows fewer people |
| `presence-unavailable` | `participants`, `share` | The call was not on screen, so the page showed nothing to read |
| `events-dropped` | `all` | Events the page dropped, between the last event before them and the first after them |

A reader must not take silence in a span as "nothing happened".

### Signals

`capture.signals` says, per signal, whether this file could observe it: `observed`, `partial`
(only some of it, such as only the people on screen) or `not-available` (the service's page does
not show it). It comes from what the service can show at best (the start reading's
`capabilities`) and from the readings this file got.

### Precision

The page checks the meeting once a second, and an event keeps the time it was first seen, so an
event is stamped at most `capture.detectionLatencyMs` (1 000) after the page showed it. The
service's own delay in showing a change is not included. Positions follow the saved file's own
clock, so an event lines up with the video frame stamped at the same moment.

Titles are kept in every mode, even without names, although a title can hold a name (a 1:1
call named after the other person).

## Versioning

- The format is `zen-recorder/meeting-notes`, its version `"MAJOR.MINOR"`: `schema` and
  `schema_version` in the front matter, `schema` and `schemaVersion` in the data block.
- Version 1.0 is amended in place until the first release of Zen Recorder that saves notes.
  From that release on, every change to what a notes file states changes the version and gets an
  entry in the changelog below. Never a silent change.
  - **MINOR** (`1.0` to `1.1`): additions only, such as a new optional field, a new event type, or
    a new value of a field marked open. A reader of `1.x` ignores fields and event types it does
    not know.
  - **MAJOR** (`1.x` to `2.0`): anything else, such as a field removed or renamed, a meaning or a
    unit changed, or a new value of a field that is not open. It comes with a note here on how to
    read files of the older version.

## Example

An invented 52-minute Google Meet call with four people; Jo Rocha is you. File
`2026-10-04_14-03_Weekly product sync.md`, next to `2026-10-04_14-03_Weekly product sync.webm`:

````markdown
---
schema: "zen-recorder/meeting-notes"
schema_version: "1.0"
title: "Weekly product sync"
service: "Google Meet"
meeting_id: "abc-defg-hij"
url: "https://meet.google.com/abc-defg-hij"
date: 2026-10-04
start: "2026-10-04T14:03:05+02:00"
end: "2026-10-04T14:57:47+02:00"
timezone: "Europe/Berlin"
recording: "2026-10-04_14-03_Weekly product sync.webm"
duration: "0:52:00"
paused: "0:02:42"
media: "video+audio"
recovered: false
names: true
participants:
  - "Jo Rocha"
  - "Ana Souza"
  - "Ben Carter"
  - "Chloé Martin | Design"
participants_count: 4
---

# Weekly product sync

Google Meet · Sunday 2026-10-04 · 14:03 to 14:57 (Europe/Berlin, UTC+02:00)

Meeting notes by zen-recorder. The `## Data` block at the end is the complete record
(schema `zen-recorder/meeting-notes` 1.0, documented at
https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes-format.md). "In file" is the position in the recording.

- **Recording:** [2026-10-04\_14-03\_Weekly product sync.webm](2026-10-04_14-03_Weekly%20product%20sync.webm), 0:52:00, video and audio
- **Link:** https://meet.google.com/abc-defg-hij
- **Recorded:** 14:03:05 to 14:57:47, paused once for 0:02:42 (not in the file)
- **Started:** automatically when another participant's audio arrived
- **Ended:** the call disconnected (you left, the meeting ended, or the network dropped)
- **Your microphone:** muted once, 0:01:30 in total
- **Participants:** names of people on screen, confirmed by the participant count. Remote screen shares: who shared is not shown by Google Meet's page.

## Participants (4)

| Id | Name | In this file |
|---|---|---|
| p1 | Jo Rocha (you) | whole recording |
| p2 | Ana Souza | whole recording |
| p3 | Ben Carter | 0:00:00 to 0:21:23, 0:23:15 to end |
| p4 | Chloé Martin \| Design | 0:01:35 to end |

## Timeline

| Time | In file | What happened |
|---|---|---|
| 14:03:05 | 0:00:00 | Recording started automatically. In the call: Jo Rocha (you), Ana Souza, Ben Carter |
| 14:04:40 | 0:01:35 | Joined: Chloé Martin \| Design |
| 14:06:12 | 0:03:07 | Someone started sharing a screen (presenter not shown by the page) |
| 14:21:30 | 0:18:25 | Screen share ended |
| 14:22:05 | 0:19:00 | You paused the recording |
| 14:24:47 | 0:19:00 | You resumed the recording (0:02:42 not recorded) |
| 14:27:10 | 0:21:23 | Left: Ben Carter |
| 14:29:02 | 0:23:15 | Joined again: Ben Carter |
| 14:31:40 | 0:25:53 | You started sharing your screen |
| 14:35:00 | 0:29:13 | Your microphone was muted |
| 14:36:30 | 0:30:43 | Your microphone was unmuted |
| 14:40:10 | 0:34:23 | You stopped sharing your screen |
| 14:44:18 | 0:38:31 | Connection lost for 3 s (others' audio may be missing) |
| 14:45:00 | 0:39:13 | Tab hidden for 2 min: people seen on screen may be incomplete until 0:41:13 |
| 14:57:42 | 0:51:55 | Connection lost; the call disconnected |
| 14:57:47 | 0:52:00 | Recording stopped |

## Data

```json
{
  "schema": "zen-recorder/meeting-notes",
  "schemaVersion": "1.0",
  "schemaUrl": "https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes-format.md",
  "generator": {"name": "zen-recorder", "version": "0.4.0"},
  "meeting": {"service": "meet", "serviceName": "Google Meet", "id": "abc-defg-hij", "title": "Weekly product sync", "url": "https://meet.google.com/abc-defg-hij"},
  "recording": {"id": "6f1c2a9e-0b7d-4e57-9a51-3c2f8e4d1b20", "file": "2026-10-04_14-03_Weekly product sync.webm", "rawFile": null, "start": "2026-10-04T14:03:05+02:00", "end": "2026-10-04T14:57:47+02:00", "timeZone": "Europe/Berlin", "durationMs": 3120000, "pausedMs": 162000, "mediaOffsetMs": 0, "media": "video+audio", "audioOnlyReason": null, "seekable": true, "recovered": false, "endEstimated": false, "startCause": "auto-first-remote", "endReason": "connections-lost", "continues": null},
  "capture": {"events": "complete", "eventsMissingReason": null, "names": true, "participantSource": "stage", "detectionLatencyMs": 1000, "signals": {"participants": "partial", "joinLeave": "observed", "share": "observed", "shareBy": "not-available", "self": "observed", "mic": "observed"}, "coverage": [
    {"signal": "all", "reason": "paused", "fromMs": 1140000, "toMs": 1140000, "fromAt": "2026-10-04T14:22:05+02:00", "toAt": "2026-10-04T14:24:47+02:00"},
    {"signal": "participants", "reason": "tab-hidden", "fromMs": 2353000, "toMs": 2473000, "fromAt": "2026-10-04T14:45:00+02:00", "toAt": "2026-10-04T14:47:00+02:00"}
  ]},
  "participants": [
    {"id": "p1", "name": "Jo Rocha", "names": ["Jo Rocha"], "self": true, "identity": "service-id", "presentAtStart": true, "presentAtEnd": true, "spans": [{"joinedMs": null, "leftMs": null}]},
    {"id": "p2", "name": "Ana Souza", "names": ["Ana Souza"], "self": false, "identity": "service-id", "presentAtStart": true, "presentAtEnd": true, "spans": [{"joinedMs": null, "leftMs": null}]},
    {"id": "p3", "name": "Ben Carter", "names": ["Ben Carter"], "self": false, "identity": "display-name", "presentAtStart": true, "presentAtEnd": true, "spans": [{"joinedMs": null, "leftMs": 1283000}, {"joinedMs": 1395000, "leftMs": null}]},
    {"id": "p4", "name": "Chloé Martin | Design", "names": ["Chloé Martin | Design"], "self": false, "identity": "service-id", "presentAtStart": false, "presentAtEnd": true, "spans": [{"joinedMs": 95000, "leftMs": null}]}
  ],
  "events": [
    {"seq": 0, "type": "recording-started", "at": "2026-10-04T14:03:05+02:00", "mediaMs": 0, "source": "page", "cause": "auto-first-remote", "media": "video", "audioOnlyReason": null, "continuesRecordingId": null, "gapMs": null, "mic": "live", "tabVisible": true, "ownShare": false},
    {"seq": 1, "type": "roster", "at": "2026-10-04T14:03:05+02:00", "mediaMs": 0, "source": "page", "why": "start", "participantSource": "stage", "present": ["p1", "p2", "p3"], "count": 3, "share": "none", "shareBy": null, "stale": false, "readAt": "2026-10-04T14:03:05+02:00", "capabilities": {"count": true, "roster": true, "self": true, "share": true, "shareBy": false}},
    {"seq": 2, "type": "participant-joined", "at": "2026-10-04T14:04:40+02:00", "mediaMs": 95000, "source": "page", "participant": "p4", "count": 4},
    {"seq": 3, "type": "share-started", "at": "2026-10-04T14:06:12+02:00", "mediaMs": 187000, "source": "page", "by": null},
    {"seq": 4, "type": "share-stopped", "at": "2026-10-04T14:21:30+02:00", "mediaMs": 1105000, "source": "page", "by": null},
    {"seq": 5, "type": "recording-paused", "at": "2026-10-04T14:22:05+02:00", "mediaMs": 1140000, "source": "page"},
    {"seq": 6, "type": "recording-resumed", "at": "2026-10-04T14:24:47+02:00", "mediaMs": 1140000, "source": "page", "pausedMs": 162000},
    {"seq": 7, "type": "participant-left", "at": "2026-10-04T14:27:10+02:00", "mediaMs": 1283000, "source": "page", "participant": "p3", "count": 3},
    {"seq": 8, "type": "participant-joined", "at": "2026-10-04T14:29:02+02:00", "mediaMs": 1395000, "source": "page", "participant": "p3", "count": 4},
    {"seq": 9, "type": "share-started", "at": "2026-10-04T14:31:40+02:00", "mediaMs": 1553000, "source": "page", "by": "p1"},
    {"seq": 10, "type": "mic", "at": "2026-10-04T14:35:00+02:00", "mediaMs": 1753000, "source": "page", "state": "muted"},
    {"seq": 11, "type": "mic", "at": "2026-10-04T14:36:30+02:00", "mediaMs": 1843000, "source": "page", "state": "live"},
    {"seq": 12, "type": "share-stopped", "at": "2026-10-04T14:40:10+02:00", "mediaMs": 2063000, "source": "page", "by": "p1"},
    {"seq": 13, "type": "connection-lost", "at": "2026-10-04T14:44:18+02:00", "mediaMs": 2311000, "source": "page"},
    {"seq": 14, "type": "connection-restored", "at": "2026-10-04T14:44:21+02:00", "mediaMs": 2314000, "source": "page", "lostMs": 3000},
    {"seq": 15, "type": "coverage-lost", "at": "2026-10-04T14:45:00+02:00", "mediaMs": 2353000, "source": "page", "signal": "participants", "reason": "tab-hidden"},
    {"seq": 16, "type": "coverage-restored", "at": "2026-10-04T14:47:00+02:00", "mediaMs": 2473000, "source": "page", "signal": "participants", "reason": "tab-hidden"},
    {"seq": 17, "type": "connection-lost", "at": "2026-10-04T14:57:42+02:00", "mediaMs": 3115000, "source": "page"},
    {"seq": 18, "type": "roster", "at": "2026-10-04T14:57:47+02:00", "mediaMs": 3120000, "source": "page", "why": "stop", "participantSource": "stage", "present": ["p1", "p2", "p3", "p4"], "count": 4, "share": "none", "shareBy": null, "stale": false, "readAt": "2026-10-04T14:57:47+02:00", "capabilities": null},
    {"seq": 19, "type": "recording-stopped", "at": "2026-10-04T14:57:47+02:00", "mediaMs": 3120000, "source": "page", "reason": "connections-lost"}
  ]
}
```
````

Other files differ where their recording did:

- **Without names**: the front matter has no `participants` list, only `participants_count`;
  `names` is false; every `name` is `null` and every `names` empty; rows read "A participant
  joined (4 in the call)". Ids and `self` stay.
- **A recovered recording**: a "Recovered recording" paragraph under the summary;
  `recovered: true`, `endReason: "recovered"`, `capture.events: "incomplete"` with
  `eventsMissingReason: "recovered"`, an `end` from the last event or saved part with
  `endEstimated: true`, and a last event `recording-stopped` with `source: "background"` and
  `reason: "recovered"` at the end of the file.
- **A video failure**: the first file ends with `video-failed`, then `recording-stopped`
  (`encoder-error`); the second has `continues` naming the first, `media: "audio"`,
  `audioOnlyReason: "video-failed"`, and the same participant ids.
- **An older meeting tab**: `capture.events: "none"` with `eventsMissingReason:
  "page-session-too-old"`, and the timeline says so.

## Changelog

- **1.0** (unreleased): the first version.
