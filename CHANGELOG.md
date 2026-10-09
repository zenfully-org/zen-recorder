# Changelog

What changed for the person recording, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions are those of
`package.json`. Entries written before the project's public issue tracker opened name no issue;
later ones end with the issue or pull request of the change. [CONTRIBUTING.md](CONTRIBUTING.md)
says how an entry is written and how a release is made.

## Unreleased

### Added

- Zen Recorder is open source, under the MIT licence.
- Releases are signed by Mozilla and published on GitHub, so they install in Firefox and every
  browser built on it without changing a pref, and Zen Recorder updates itself: the browser
  checks for a new version once a day and installs it.
- The Options page shows the version and says that Zen Recorder is an independent project, not
  affiliated with Zen Browser.
- When the recording cannot be saved because the disk is full, the meeting tab says so in an
  error message next to its status card, while the call goes on, so you can free some space in
  time. It says so once, and again only if saving worked in between. Before, only the
  Diagnostics log knew, and the status card looked fine until the video stopped a few minutes
  later. (#3)

### Changed

- The add-on has a new id, `zen-recorder@zenfully-org.github.io`, which names the project.
  Firefox treats it as a different add-on: it does not update the old one into it, and nothing
  the old one kept carries over. Move to it once, by hand:
  1. Let every recording finish and save. In the popup, no recording may still be "recording" or
     "finalizing", and a "failed" or "interrupted" one you want gets **Retry save** first.
     Removing the old add-on deletes everything it had not saved to disk yet.
  2. Write down your settings (there is no export), and the keyboard shortcut if you changed it.
  3. Close the meeting tabs. The old recorder stays inside an open meeting tab until the tab
     reloads, and the new add-on cannot record that tab before then.
  4. `about:addons` → Zen Recorder → **Remove**.
  5. Install the new XPI, accept the site permissions (Meet, Zoom, Teams), and enter your settings
     again in **Settings**.

  Recordings already saved stay where they are (`Downloads/zen-recorder/` by default).
- The recording indicator on the meeting page no longer covers the meeting's own buttons. It is
  now a small status card on the right edge: a dot that says whether it records, and the time.
  Click it (or press Enter on it) for the microphone, the video and the Record, Pause, Resume and
  Stop buttons; click again or press Escape to close them. Drag it anywhere: Google Meet, Zoom and
  Microsoft Teams each remember where you left it, after a reload and in later meetings. The
  "saved" and error messages appear next to it. It never takes the keyboard focus from the
  meeting.
- Zen Recorder no longer asks for access to your browser tabs, so the install prompt no longer
  lists "Access browser tabs". It never used that access: the keyboard shortcut only asks the
  browser which tab is in front, and works as before. Updating to this version asks nothing.

### Removed

- The popup's **Play** button. It never opened the recording: the browser lets an add-on open a
  downloaded file only with a permission of its own, and only from the click itself. **Show
  file** shows the recording in its folder, where it opens with a double click. (#17)

### Fixed

- A recording that starts and stops within the second or so Zen Recorder takes to restart its
  background part (Firefox restarts it from time to time, and so does an update) is saved. Before,
  no file was saved, and Diagnostics said "no file is saved for recording …". (#2)
- When the meeting page holds as much as it can of a recording that could not be saved yet (a
  full disk for a few minutes), its status card says so until it is over: **Audio only** once
  the video stopped and the rest of the call is recorded as audio only, **Waiting for space**
  while nothing records at all, with the whole story in its details and a message next to it the
  first time. Before, the card went on looking like a normal recording, and said "Saving…" while
  nothing was saved or recorded; only the Diagnostics log said that the video had stopped. (#4)
- After the browser restarted, **Show file** could show another download instead of the
  recording, often the next recording, or fail with "Invalid download id". It now always looks
  for the recording's own file. The browser forgets its finished downloads when it restarts, so
  for a recording saved before, Show file opens the download folder and says where the file was
  saved. (#16)
- A recording whose tab died while Zen Recorder could not mark it as interrupted (a full disk)
  no longer looks like a live recording in the popup. A minute after its last part arrived, it
  says "not saved yet (tab closed)" and offers **Retry save**, which saves it as `(recovered)`,
  and **Remove**. Before, it showed "recording" with no button until the add-on next started,
  which could be hours. **Remove** now says when a recording is not saved and what it recorded
  would be deleted. (#10)
- A recording whose tab was lost keeps `(recovered)` in its file name when its save is retried.
  The name says that the end of the meeting may be missing. Before, a retry from the popup after
  a failed save, or the save the add-on finished after it restarted, named it like a complete
  recording. (#11)
- Saved videos show the meeting's colours. Firefox converts the video's colours with one standard
  (BT.601) and labelled the file with another (BT.709), so players that follow the label showed
  strong colours shifted: a pure green came out about 15 % darker, and reds and magentas leaned
  orange and pink. Zen Recorder now labels the file with the standard Firefox uses. (#37)
- When the popup's **Grant access** or **Settings** fails, the popup says why, for example when
  the browser refused to ask for access to the meeting sites. Before, nothing happened. (#86)
- When the popup's **Record now**, **Pause**, **Resume**, **Stop & save** or **Diagnostics**
  fails, the popup says why, for example when the meeting tab closed or reloaded just before the
  click, or when the browser refused to copy the log. Before, nothing happened. (#18)
- When **Show file**, **Retry save** or **Remove** fails, the popup says why under the
  recording, for example when the browser's download list no longer has the file. Before,
  nothing happened. (#17)
- Every frame of a saved video has a time of its own. Before, a few frames of most recordings had
  the same time as the frame before them, more often around a pause: ffmpeg reported "non
  monotonically increasing dts" when it read the file, and a player or video editor could drop
  such a frame or show it out of order. (#7)
- A recording keeps its last seconds when you close the meeting tab or the page navigates away.
  Before, the file ended up to 3 seconds before that moment, so most calls lost their goodbyes.
  With audio only (video switched off), the last seconds can still be missing. (#1)
- A recording that stopped while Zen Recorder could not take it (a full disk, the add-on disabled)
  is saved whole even when the add-on restarts before it is back. Before, the restarted add-on
  saved it at once as "(recovered)", without the part the meeting page still held, and threw that
  part away when it arrived.
- A recording is saved even when the browser's storage refused its start for a moment (a nearly
  full disk). Before, no file was saved and the popup did not list the recording. When it still
  cannot be saved at its end, Diagnostics now say so.
- While Zen Recorder cannot take the recording (a full disk, the add-on disabled or restarting), a
  recording that ends and starts again goes on at once in a new file: after an audio encoder
  error, Stop then Record, or a new meeting in the same tab. Before, nothing was recorded until
  Zen Recorder could take the recording again. The meeting page still holds at most 64 MiB of
  video recordings and 64 MiB of audio-only ones, now counted over all their files.
- A meeting page no longer learns from its own security policy that Zen Recorder is there. Each
  time the page loaded, Zen Recorder tried once to run code built from a string, which Google Meet
  and Microsoft Teams refuse: their page saw the attempt, and Meet's policy reports such attempts
  to Google. On Zoom, which allows it, that code ran inside the meeting page. Zen Recorder now
  runs no code built from a string anywhere.
- The popup shows the right size for a recording while it records, and for one whose save failed.
  Before, a piece of the recording that the browser stored slowly was counted twice, and pieces
  that arrived before the recording was announced were not counted.
- Pieces of a recording whose start never reached Zen Recorder no longer stay in the browser's
  storage for good. They cannot become a file, and they are now deleted a day after the last one
  arrived.
- A recording has sound from its first moment. Zen Recorder now gets the browser's audio ready
  while you are in a meeting, once the meeting page may play sound (after you click in it, or
  while it uses your microphone). Before, the browser started its audio only when the recording
  began, and in a meeting page that was not playing sound yet, the first second or so of the
  recording was silent.
- A meeting tab that crashes while it records is saved as "(recovered)" about 10 seconds later,
  every time. Before, when the tab died just as its last seconds were being stored, the recording
  stayed "recording" until the add-on or the browser started again, and on a very slow disk the
  file could miss those seconds.
- Closing the meeting tab, or a meeting page that navigates away (Zoom's Leave on a busy computer,
  OK on Zoom's "ended by the host" dialog), saves the recording within a second under its usual
  name. Before, it came about 10 seconds later named "(recovered)", and a call left just before
  the page went away was not saved until the add-on or the browser started again. The file holds
  what the tab had handed over by then, so its last few seconds can still be missing.
- A recording that ends while the add-on restarts (an update or a reload just as you press Stop)
  is saved at once under its own name. Before, it stayed "recording" until the browser started
  again and was then saved as "(recovered)".
- Pause and Stop keep the audio up to the moment you press them, even when the meeting page is
  busy. Before, Stop could lose the last seconds, and Resume added silence for them.
- A busy computer, or the clock of the audio device over a long meeting, no longer adds silence
  to the recording. Before, files grew longer than the meeting and the audio drifted away from
  the video.
- A microphone the meeting page stopped (Teams' permission check, Zoom's microphone test) is no
  longer the one recorded. Before, your voice could be missing for the rest of the meeting.
- An error of the audio encoder saves the file so far and goes on recording in a new file, as
  other encoder errors do. Before, it ended the recording as if you had pressed Stop, and
  automatic recording stayed off for the rest of the meeting.
- A recording you paused stays paused when the encoder fails and the recording restarts: nothing
  is recorded until you press Resume. Before, the new file held what you had paused.
- Stopping before anything was recorded no longer saves an unplayable file. No file is saved, and
  the popup and Diagnostics say that nothing was recorded.
- A meeting title with invisible characters (the joiner inside some emoji, right-to-left marks,
  soft hyphens) no longer makes the save fail. A name the browser still refuses is saved as
  `YYYY-MM-DD_HH-mm_recording.webm`.
- Two recordings that end at the same moment under the same name are both kept, the second with
  `(1)` in its name. Before, one of them, or both, could be lost.
- A short recording no longer stays "finalizing" for 10 minutes and then shows as failed although
  its file was saved.
- Saving a long recording no longer holds up the next recording in the same tab.
- A part of a recording that cannot be stored (a full disk, for example) is sent again, and
  Diagnostics say so. Before, the recording stayed "recording" without a file or a log line.
- When the add-on cannot take a recording for minutes (a full disk, or the add-on disabled during
  a call), the meeting tab no longer fills its memory and no part of the recording is thrown away.
  Once the tab holds 64 MiB of it, about 3.5 minutes of video, the video stops and the rest of the
  call is recorded as audio only in a new file; both files are saved whole once the add-on is
  back, and Diagnostics say why. Before, the tab kept up to 400 parts (up to 400 MB with video),
  then threw the oldest away, leaving a hole in the file, or a file that does not play when the
  trouble began with the recording.
- When the video fails while the add-on cannot take the recording for a moment (it is restarting
  or updating, or the disk is full), the call goes on as audio only at once. Before, nothing was
  recorded until the add-on had taken the whole video recording, so that part of the call was in
  no file.
- When a closed tab's recording cannot be recovered, Diagnostics say so and the other recordings
  are still recovered; the failed one is tried again at the next start.
- On Zoom, a host alone in the meeting no longer starts recording when a guest knocks: recording
  starts once the guest is let in.

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
