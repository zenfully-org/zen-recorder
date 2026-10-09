# Changelog

What changed for the person recording, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions are those of
`package.json`. Entries written before the project's public issue tracker opened name no issue;
later ones end with the issue or pull request of the change. [CONTRIBUTING.md](CONTRIBUTING.md)
says how an entry is written and how a release is made.

## Unreleased

The entries of the next release are files in [`changes/`](changes/), one per change, so that two
pull requests never edit the same lines here. `pnpm changelog` prints them as this section will
read, and the release writes them here under its version.

## 0.3.0 - 2026-10-01

### Added

- Zoom (the web client, "Join from browser") and Microsoft Teams (`teams.microsoft.com`,
  `teams.live.com`, `teams.cloud.microsoft`), next to Google Meet. Each service needs its site
  permission; the popup shows **Grant access** for one you have not allowed.
- The `{provider}` token for the file name, and the popup names the service of each recording.
- "video perf" lines in Diagnostics: what the video costs on this computer.

### Changed

- Video costs less: when the computer cannot keep up, the frame rate drops to 7.5 or 5 frames per
  second and comes back once the load allows; frames where nothing changed are skipped while the
  tab is in front, and Zoom's tiles are drawn several times faster.

## 0.2.0 - 2026-09-07

### Added

- Records Google Meet calls in Firefox and Zen: it starts once you are in the call and someone
  else is there, stops when you leave, and saves one seekable WebM file per meeting to
  `Downloads/zen-recorder/`. The file holds everyone's audio and your microphone, silent while you
  are muted in Meet.
- Video: the participants' tiles with their names and a shared screen, composited into one
  picture, also while the tab is in the background; audio only when the browser cannot encode
  video. Video can be turned off or set up in Options.
- Record, Pause, Resume and Stop by hand, from the overlay on the meeting page or the popup, also
  while you are alone in the call; `Alt+Shift+R` records and stops.
- A recording survives a closed tab, a crash or an update of the add-on mid-call: its pieces are
  kept in the browser while it runs, and a recording whose tab is gone is saved as "(recovered)".
- The popup lists the recent recordings and copies a Diagnostics log for bug reports.
