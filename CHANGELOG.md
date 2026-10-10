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

## 0.4.0 - 2026-10-10

### Added

- When the recording cannot be saved because the disk is full, the meeting tab says so in an
  error message next to its status card, while the call goes on, so you can free some space in
  time. It says so once, and again only if saving worked in between. Before, only the
  Diagnostics log knew, and the status card looked fine until the video stopped a few minutes
  later. (#3)
- After an outage that stopped the video (the meeting page held as much as it could, for example
  while the disk was full), the video comes back once Zen Recorder has saved what the page held
  and keeps up again, in a new file. Before, the rest of the meeting was recorded as audio only.
  (#5)
- Zen Recorder is on Firefox Add-ons (addons.mozilla.org): open its page and click **Add to
  Firefox**. It installs in Firefox and the browsers built on it, Zen included, without changing a
  pref. Each version is also on GitHub Releases, the same file signed by Mozilla, and Zen Recorder
  updates itself from addons.mozilla.org however you installed it. (#24)
- Every saved recording gets its meeting notes: a Markdown file with the same name next to it
  (`Weekly sync.md` beside `Weekly sync.webm`). It says what the meeting was (its service, title,
  link and date), when the recording started and stopped and why, and how long it is, each event at
  its position in the recording, in a documented format an AI assistant can read. Settings →
  **Meeting notes** turns the file off, or leaves the participants' names out. (#30)
- The popup says it too when a meeting tab records audio only, or nothing, because the page holds
  as much as it can of a recording that could not be saved yet: its card for that meeting shows
  **Audio only** or **Waiting for space** with the same sentence as the status card, and says
  "Not recording" instead of "Saving…" while nothing records. So you see it also with the status
  card turned off. (#77)
- The Options page shows the version and says that Zen Recorder is an independent project, not
  affiliated with Zen Browser.
- Zen Recorder is open source, under the MIT licence.

### Changed

- On Microsoft Teams, the recording's audio is read off the page's main thread, as on Google Meet
  and Zoom: a busy Teams page has less to do, and a pause or a stop takes effect where you pressed
  it rather than up to a third of a second later. Before, Teams' security policy kept Zen Recorder
  from loading its audio worklet there. (#43)
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
  5. Install Zen Recorder from Firefox Add-ons (or the XPI of the GitHub Release), accept the site
     permissions (Meet, Zoom, Teams), and enter your settings again in **Settings**.

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

- A recording keeps its last seconds when you close the meeting tab or the page navigates away.
  Before, the file ended up to 3 seconds before that moment, so most calls lost their goodbyes.
  With audio only (video switched off), the last seconds can still be missing. (#1)
- A recording that starts and stops within the second or so Zen Recorder takes to restart its
  background part (Firefox restarts it from time to time, and so does an update) is saved. Before,
  no file was saved, and Diagnostics said "no file is saved for recording …". (#2)
- When the meeting page holds as much as it can of a recording that could not be saved yet (a
  full disk for a few minutes), its status card says so until it is over: **Audio only** once
  the video stopped and the rest of the call is recorded as audio only, **Waiting for space**
  while nothing records at all, with the whole story in its details and a message next to it the
  first time. Before, the card went on looking like a normal recording, and said "Saving…" while
  nothing was saved or recorded; only the Diagnostics log said that the video had stopped. (#4)
- Stop and Pause end within a few seconds even while the meeting page is busy for a long time.
  Before, a page that ran long tasks fell behind on its audio for as long as it stayed busy, and
  Stop waited, with the status card on "Saving…", until it caught up, often until the page was
  idle again. Nothing was lost either way. (#6)
- Every frame of a saved video has a time of its own. Before, a few frames of most recordings had
  the same time as the frame before them, more often around a pause: ffmpeg reported "non
  monotonically increasing dts" when it read the file, and a player or video editor could drop
  such a frame or show it out of order. (#7)
- A Downloads subfolder named like `meetings.local` (ending in `.lnk`, `.local`, `.url`, `.scf`
  or `.desktop`) no longer makes every recording fail to save: the folder is created as
  `meetings_local`, because Firefox refuses such a folder name. (#8)
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
- The popup no longer offers **Retry save** for a recording Zen Recorder refused to save
  because nothing playable was recorded (no audio arrived, the start of the file was lost, or Stop
  came before the first sound or picture): a retry could only refuse again. It offers **Remove**.
  (#12)
- Diagnostics say when Zen Recorder could not send a meeting tab its settings, update the toolbar
  badge, or find the active tab for the keyboard shortcut. Before, these failures went unreported,
  so the log could not explain a tab that kept its old settings, a badge that did not change, or
  a shortcut that did nothing. (#13)
- The Diagnostics log keeps the meeting page's lines written while Zen Recorder's background was
  restarting (an update, or the browser suspending it), and lists every line at the time it was
  written. Before, those lines were missing, and they are often the ones a bug report needs.
  (#14)
- After the browser restarted, **Show file** could show another download instead of the
  recording, often the next recording, or fail with "Invalid download id". It now always looks
  for the recording's own file. The browser forgets its finished downloads when it restarts, so
  for a recording saved before, Show file opens the download folder and says where the file was
  saved. (#16)
- When **Show file**, **Retry save** or **Remove** fails, the popup says why under the
  recording, for example when the browser's download list no longer has the file. Before,
  nothing happened. (#17)
- When the popup's **Record now**, **Pause**, **Resume**, **Stop & save** or **Diagnostics**
  fails, the popup says why, for example when the meeting tab closed or reloaded just before the
  click, or when the browser refused to copy the log. Before, nothing happened. (#18)
- When the recording keeps failing (the browser's encoder broke four times in a row) and Zen
  Recorder stops starting it again, the status card says "Not recording" and "Recording failed",
  tells you once that Record tries again, and the popup says the same. Before, the card and the
  popup looked ready to record, and only the Diagnostics log said why nothing was recorded. (#19)
- The messages about a recording show only in the meeting tab that recorded it: "Recording
  saved", a save that failed, and the warning that little storage is left. Before, every other
  meeting tab that was not recording showed them too, about a meeting it never recorded. (#20)
- Alone in a Zoom or Microsoft Teams meeting, the status card and the popup say "Waiting for
  participants". Before, they said the recording was ready, though Zen Recorder rightly waited
  for someone else: Zoom and Teams play the meeting's audio from the moment you join, and the
  card and the popup counted that audio instead of the people. (#21)
- A meeting page's own scripts can no longer reach Zen Recorder through the page's window. Before,
  any script on the page could find the recording session there and stop it, and could change the
  settings of zod, the library Zen Recorder checks its messages with. (#22)
- Saved videos show the meeting's colours. Firefox converts the video's colours with one standard
  (BT.601) and labelled the file with another (BT.709), so players that follow the label showed
  strong colours shifted: a pure green came out about 15 % darker, and reds and magentas leaned
  orange and pink. Zen Recorder now labels the file with the standard Firefox uses. (#37)
- Where the meeting page shows one video over another, such as your own picture floating over
  the stage, the recording shows the same one on top. Before, it could show the one underneath
  instead, and on Microsoft Teams it picked one at random. (#38)
- On Zoom, the meeting page no longer freezes at every recorded frame while Zoom is busy, as it
  is right after you join. Taking a picture of Zoom's video makes the browser wait for Zoom, and
  each wait could last up to a second; in a test the page was frozen 6 seconds out of 8. When one
  picture takes that long, Zen Recorder now draws those participants as placeholders for a few
  seconds and tries again later, and Diagnostics say so. (#39)
- On Google Meet, a participant whose camera is off appears in the recording as their initials,
  where the page shows their tile. Before, their tile was left out, and alone in a call with your
  camera off the whole video said "No video tiles". (#42)
- A meeting tab closed while it records is saved at once under its own name, also on a busy
  computer. Before, the browser could lose the tab's last message on the way, and the recording
  was saved 10 seconds later as "(recovered)": whole, but named as if the tab had crashed. (#72)
- When the popup's **Grant access** or **Settings** fails, the popup says why, for example when
  the browser refused to ask for access to the meeting sites. Before, nothing happened. (#86)
- On Google Meet, a call where you are alone no longer starts recording by itself: recording
  starts once someone else joins, even muted with the camera off. Before, Zen Recorder counted
  the call's audio channels, which Meet opens as soon as you join, so a call nobody else had
  joined was recorded from the start. (#103)
- A meeting page's own scripts no longer see what Zen Recorder records: the recorder talks to the
  extension over a private channel instead of the page's window, so the page's listeners receive
  none of the recording, and a page script can no longer stop the recording by posting to it.
  (#131)
- A meeting page's own scripts can no longer read what the status card shows: whether it records,
  for how long, and what went wrong. (#132)
- A busy computer, or the clock of the audio device over a long meeting, no longer adds silence
  to the recording. Before, files grew longer than the meeting and the audio drifted away from
  the video.
- A meeting page no longer learns from its own security policy that Zen Recorder is there. Each
  time the page loaded, Zen Recorder tried once to run code built from a string, which Google Meet
  and Microsoft Teams refuse: their page saw the attempt, and Meet's policy reports such attempts
  to Google. On Zoom, which allows it, that code ran inside the meeting page. Zen Recorder now
  runs no code built from a string anywhere.
- A meeting tab that crashes while it records is saved as "(recovered)" about 10 seconds later,
  every time. Before, when the tab died just as its last seconds were being stored, the recording
  stayed "recording" until the add-on or the browser started again, and on a very slow disk the
  file could miss those seconds.
- A meeting title with invisible characters (the joiner inside some emoji, right-to-left marks,
  soft hyphens) no longer makes the save fail. A name the browser still refuses is saved as
  `YYYY-MM-DD_HH-mm_recording.webm`.
- A microphone the meeting page stopped (Teams' permission check, Zoom's microphone test) is no
  longer the one recorded. Before, your voice could be missing for the rest of the meeting.
- A part of a recording that cannot be stored (a full disk, for example) is sent again, and
  Diagnostics say so. Before, the recording stayed "recording" without a file or a log line.
- A recording has sound from its first moment. Zen Recorder now gets the browser's audio ready
  while you are in a meeting, once the meeting page may play sound (after you click in it, or
  while it uses your microphone). Before, the browser started its audio only when the recording
  began, and in a meeting page that was not playing sound yet, the first second or so of the
  recording was silent.
- A recording is saved even when the browser's storage refused its start for a moment (a nearly
  full disk). Before, no file was saved and the popup did not list the recording. When it still
  cannot be saved at its end, Diagnostics now say so.
- A recording that ends while the add-on restarts (an update or a reload just as you press Stop)
  is saved at once under its own name. Before, it stayed "recording" until the browser started
  again and was then saved as "(recovered)".
- A recording that stopped while Zen Recorder could not take it (a full disk, the add-on disabled)
  is saved whole even when the add-on restarts before it is back. Before, the restarted add-on
  saved it at once as "(recovered)", without the part the meeting page still held, and threw that
  part away when it arrived.
- A recording you paused stays paused when the encoder fails and the recording restarts: nothing
  is recorded until you press Resume. Before, the new file held what you had paused.
- A short recording no longer stays "finalizing" for 10 minutes and then shows as failed although
  its file was saved.
- An error of the audio encoder saves the file so far and goes on recording in a new file, as
  other encoder errors do. Before, it ended the recording as if you had pressed Stop, and
  automatic recording stayed off for the rest of the meeting.
- Closing the meeting tab, or a meeting page that navigates away (Zoom's Leave on a busy computer,
  OK on Zoom's "ended by the host" dialog), saves the recording within a second under its usual
  name. Before, it came about 10 seconds later named "(recovered)", and a call left just before
  the page went away was not saved until the add-on or the browser started again.
- On Zoom, a host alone in the meeting no longer starts recording when a guest knocks: recording
  starts once the guest is let in.
- Pause and Stop keep the audio up to the moment you press them, even when the meeting page is
  busy. Before, Stop could lose the last seconds, and Resume added silence for them.
- Pieces of a recording whose start never reached Zen Recorder no longer stay in the browser's
  storage for good. They cannot become a file, and they are now deleted a day after the last one
  arrived.
- Saving a long recording no longer holds up the next recording in the same tab.
- Stopping before anything was recorded no longer saves an unplayable file. No file is saved, and
  the popup and Diagnostics say that nothing was recorded.
- The popup shows the right size for a recording while it records, and for one whose save failed.
  Before, a piece of the recording that the browser stored slowly was counted twice, and pieces
  that arrived before the recording was announced were not counted.
- Two recordings that end at the same moment under the same name are both kept, the second with
  `(1)` in its name. Before, one of them, or both, could be lost.
- When a closed tab's recording cannot be recovered, Diagnostics say so and the other recordings
  are still recovered; the failed one is tried again at the next start.
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
- While Zen Recorder cannot take the recording (a full disk, the add-on disabled or restarting), a
  recording that ends and starts again goes on at once in a new file: after an audio encoder
  error, Stop then Record, or a new meeting in the same tab. Before, nothing was recorded until
  Zen Recorder could take the recording again. The meeting page still holds at most 64 MiB of
  video recordings and 64 MiB of audio-only ones, now counted over all their files.

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
