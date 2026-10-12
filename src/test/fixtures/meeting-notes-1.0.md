---
schema: "zen-recorder/meeting-notes"
schema_version: "1.0"
title: "Q4 planning | *draft*"
service: "Zoom"
meeting_id: "1234567890"
url: "https://zoom.us/j/1234567890"
date: 2026-10-25
start: "2026-10-25T02:40:00+02:00"
end: "2026-10-25T02:15:01+01:00"
timezone: "Europe/Berlin"
recording: "2026-10-25_02-40_Q4 planning _ _draft_.webm"
duration: "0:33:00"
paused: "0:02:00"
media: "video+audio"
recovered: false
names: true
participants:
  - "Jo Rocha"
  - "Ana Souza"
  - "Ben Carter"
participants_count: 4
---

# Q4 planning \| \*draft\*

Zoom · Sunday 2026-10-25 · 02:40 to 02:15 (Europe/Berlin, UTC+02:00 to UTC+01:00)

Meeting notes by zen-recorder. The `## Data` block at the end is the complete record
(schema `zen-recorder/meeting-notes` 1.0, documented at
https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes-format.md). "In file" is the position in the recording.

- **Recording:** [2026-10-25\_02-40\_Q4 planning \_ \_draft\_.webm](2026-10-25_02-40_Q4%20planning%20_%20_draft_.webm), 0:33:00, video and audio
- **Raw copy:** [2026-10-25\_02-40\_Q4 planning \_ \_draft\_ raw.webm](2026-10-25_02-40_Q4%20planning%20_%20_draft_%20raw.webm)
- **Link:** https://zoom.us/j/1234567890
- **Recorded:** 02:40:00 to 02:15:01 (UTC+01:00), paused once for 0:02:00 (not in the file)
- **Started:** when you pressed Record
- **Ended:** the recording failed (an encoder error); it may go on in another file
- **Your microphone:** muted once, 0:04:00 in total
- **Participants:** names of people on screen, confirmed by the participant count.

## Participants (4)

| Id | Name | In this file |
|---|---|---|
| p1 | Jo Rocha (you) | whole recording |
| p2 | Ana Souza | 0:00:00 to 0:10:00 |
| p3 | Ben Carter | 0:02:00 to end |
| p4 | (name not shown) | 0:05:00 to end |

## Timeline

| Time | In file | What happened |
|---|---|---|
| 02:40:00 | 0:00:00 | You started the recording. In the call: Jo Rocha (you), Ana Souza. Your microphone was muted |
| 02:42:00 | 0:02:00 | Joined: Ben Carter |
| 02:43:00 | 0:03:00 | Renamed: Ben → Ben Carter |
| 02:44:00 | 0:04:00 | Your microphone was unmuted |
| 02:45:00 | 0:05:00 | Joined: (name not shown) |
| 02:46:00 | 0:06:00 | Ben Carter started sharing a screen |
| 02:47:00 | 0:07:00 | The call was not on screen for 30 s: screen shares may be missing until 0:07:30 |
| 02:48:00 | 0:08:00 | Ben Carter stopped sharing a screen |
| 02:49:00 | 0:09:00 | Title changed to: Q4 planning \| final |
| 02:50:00 | 0:10:00 | You paused the recording |
| 02:51:00 | 0:10:00 | Left: Ana Souza (while paused) |
| 02:52:00 | 0:10:00 | You resumed the recording (0:02:00 not recorded) |
| 02:55:00 | 0:13:00 | Zen Recorder was reloaded or updated; the recording went on |
| 02:58:00 | 0:16:00 | 5 people in the call |
| 02:59:50 | 0:17:50 | Connection lost for 20 s (others' audio may be missing) |
| 02:05:00 (UTC+01:00) | 0:23:00 | Tab hidden for 3 min: people seen on screen may be incomplete until 0:26:00 |
| 02:15:00 (UTC+01:00) | 0:33:00 | The video failed: the meeting goes on in a new file, audio only |
| 02:15:01 (UTC+01:00) | 0:33:00 | Recording stopped: the recording failed (an encoder error); it may go on in another file (placed at the end of the file) |

## Data

```json
{
  "schema": "zen-recorder/meeting-notes",
  "schemaVersion": "1.0",
  "schemaUrl": "https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes-format.md",
  "generator": {"name": "zen-recorder", "version": "0.4.0"},
  "meeting": {"service": "zoom", "serviceName": "Zoom", "id": "1234567890", "title": "Q4 planning | *draft*", "url": "https://zoom.us/j/1234567890"},
  "recording": {"id": "0b2d6f4e-7a1c-4c3e-8f5a-9d2e1b0c7a64", "file": "2026-10-25_02-40_Q4 planning _ _draft_.webm", "rawFile": "2026-10-25_02-40_Q4 planning _ _draft_ raw.webm", "start": "2026-10-25T02:40:00+02:00", "end": "2026-10-25T02:15:01+01:00", "timeZone": "Europe/Berlin", "durationMs": 1980500, "pausedMs": 120000, "mediaOffsetMs": 12, "media": "video+audio", "audioOnlyReason": null, "seekable": true, "recovered": false, "endEstimated": false, "startCause": "manual", "endReason": "encoder-error", "continues": null},
  "capture": {"events": "complete", "eventsMissingReason": null, "names": true, "participantSource": "stage", "detectionLatencyMs": 1000, "signals": {"participants": "partial", "joinLeave": "observed", "share": "observed", "shareBy": "observed", "self": "not-available", "mic": "observed"}, "coverage": [
    {"signal": "all", "reason": "paused", "fromMs": 600000, "toMs": 600000, "fromAt": "2026-10-25T02:50:00+02:00", "toAt": "2026-10-25T02:52:00+02:00"},
    {"signal": "share", "reason": "presence-unavailable", "fromMs": 420000, "toMs": 450000, "fromAt": "2026-10-25T02:47:00+02:00", "toAt": "2026-10-25T02:47:30+02:00"},
    {"signal": "participants", "reason": "tab-hidden", "fromMs": 1380000, "toMs": 1560000, "fromAt": "2026-10-25T02:05:00+01:00", "toAt": "2026-10-25T02:08:00+01:00"}
  ]},
  "participants": [
    {"id": "p1", "name": "Jo Rocha", "names": ["Jo Rocha"], "self": true, "identity": "service-id", "presentAtStart": true, "presentAtEnd": true, "spans": [{"joinedMs": null, "leftMs": null}]},
    {"id": "p2", "name": "Ana Souza", "names": ["Ana Souza"], "self": false, "identity": "service-id", "presentAtStart": true, "presentAtEnd": false, "spans": [{"joinedMs": null, "leftMs": 600000}]},
    {"id": "p3", "name": "Ben Carter", "names": ["Ben", "Ben Carter"], "self": false, "identity": "service-id", "presentAtStart": false, "presentAtEnd": true, "spans": [{"joinedMs": 120000, "leftMs": null}]},
    {"id": "p4", "name": null, "names": [], "self": null, "identity": "display-name", "presentAtStart": false, "presentAtEnd": true, "spans": [{"joinedMs": 300000, "leftMs": null}]}
  ],
  "events": [
    {"seq": 0, "type": "recording-started", "at": "2026-10-25T02:40:00+02:00", "mediaMs": 0, "source": "page", "cause": "manual", "media": "video", "audioOnlyReason": null, "continuesRecordingId": null, "gapMs": null, "mic": "muted", "tabVisible": true, "ownShare": false},
    {"seq": 1, "type": "roster", "at": "2026-10-25T02:40:00+02:00", "mediaMs": 0, "source": "page", "why": "start", "participantSource": "stage", "present": ["p1", "p2"], "count": 2, "share": "none", "shareBy": null, "stale": false, "readAt": "2026-10-25T02:40:00+02:00", "capabilities": {"count": true, "roster": false, "self": false, "share": true, "shareBy": true}},
    {"seq": 2, "type": "participant-joined", "at": "2026-10-25T02:42:00+02:00", "mediaMs": 120000, "source": "page", "participant": "p3", "count": 3},
    {"seq": 3, "type": "participant-renamed", "at": "2026-10-25T02:43:00+02:00", "mediaMs": 180000, "source": "page", "participant": "p3", "from": "Ben"},
    {"seq": 4, "type": "mic", "at": "2026-10-25T02:44:00+02:00", "mediaMs": 240000, "source": "page", "state": "live"},
    {"seq": 5, "type": "participant-joined", "at": "2026-10-25T02:45:00+02:00", "mediaMs": 300000, "source": "page", "participant": "p4", "count": 4},
    {"seq": 6, "type": "share-started", "at": "2026-10-25T02:46:00+02:00", "mediaMs": 360000, "source": "page", "by": "p3"},
    {"seq": 7, "type": "coverage-lost", "at": "2026-10-25T02:47:00+02:00", "mediaMs": 420000, "source": "page", "signal": "share", "reason": "presence-unavailable"},
    {"seq": 8, "type": "coverage-restored", "at": "2026-10-25T02:47:30+02:00", "mediaMs": 450000, "source": "page", "signal": "share", "reason": "presence-unavailable"},
    {"seq": 9, "type": "share-stopped", "at": "2026-10-25T02:48:00+02:00", "mediaMs": 480000, "source": "page", "by": "p3"},
    {"seq": 10, "type": "title-changed", "at": "2026-10-25T02:49:00+02:00", "mediaMs": 540000, "source": "page", "title": "Q4 planning | final"},
    {"seq": 11, "type": "recording-paused", "at": "2026-10-25T02:50:00+02:00", "mediaMs": 600000, "source": "page"},
    {"seq": 12, "type": "participant-left", "at": "2026-10-25T02:51:00+02:00", "mediaMs": 600000, "source": "page", "paused": true, "participant": "p2", "count": 3},
    {"seq": 13, "type": "recording-resumed", "at": "2026-10-25T02:52:00+02:00", "mediaMs": 600000, "source": "page", "pausedMs": 120000},
    {"seq": 14, "type": "extension-reloaded", "at": "2026-10-25T02:55:00+02:00", "mediaMs": 780000, "source": "page"},
    {"seq": 15, "type": "roster", "at": "2026-10-25T02:55:00+02:00", "mediaMs": 780000, "source": "page", "why": "reannounce", "participantSource": "stage", "present": ["p1", "p3", "p4"], "count": 3, "share": "none", "shareBy": null, "stale": false, "readAt": "2026-10-25T02:55:00+02:00", "capabilities": null},
    {"seq": 16, "type": "participant-count", "at": "2026-10-25T02:58:00+02:00", "mediaMs": 960000, "source": "page", "count": 5},
    {"seq": 17, "type": "connection-lost", "at": "2026-10-25T02:59:50+02:00", "mediaMs": 1070000, "source": "page"},
    {"seq": 18, "type": "connection-restored", "at": "2026-10-25T02:00:10+01:00", "mediaMs": 1090000, "source": "page", "lostMs": 20000},
    {"seq": 19, "type": "coverage-lost", "at": "2026-10-25T02:05:00+01:00", "mediaMs": 1380000, "source": "page", "signal": "participants", "reason": "tab-hidden"},
    {"seq": 20, "type": "coverage-restored", "at": "2026-10-25T02:08:00+01:00", "mediaMs": 1560000, "source": "page", "signal": "participants", "reason": "tab-hidden"},
    {"seq": 21, "type": "video-failed", "at": "2026-10-25T02:15:00+01:00", "mediaMs": 1980000, "source": "page"},
    {"seq": 22, "type": "roster", "at": "2026-10-25T02:15:01+01:00", "mediaMs": 1980500, "source": "page", "clamped": true, "why": "stop", "participantSource": "stage", "present": ["p1", "p3", "p4"], "count": 5, "share": "none", "shareBy": null, "stale": false, "readAt": "2026-10-25T02:15:01+01:00", "capabilities": null},
    {"seq": 23, "type": "recording-stopped", "at": "2026-10-25T02:15:01+01:00", "mediaMs": 1980500, "source": "page", "clamped": true, "reason": "encoder-error"}
  ]
}
```
