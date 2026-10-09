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
