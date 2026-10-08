# Zen Recorder privacy policy

Last changed: 2026-10-05.

**In short**

Zen Recorder records the meetings you take part in on Google Meet, Zoom and Microsoft Teams, and
saves them as files on your own computer. It sends nothing anywhere. The project runs no servers,
and the extension has no accounts, no analytics, no advertising and no crash reporting. Nobody but
you gets your recordings.

**What the extension records**

- The sound of the call: everyone you hear, and your own microphone. When you mute yourself in the
  meeting, your microphone is silent in the recording too.
- With video turned on (the default), the video of the call as the meeting page shows it to you: the
  participants' tiles, with the names the page shows on them, and a shared screen.

It records only in the meeting pages of those three services. A recording starts when you press
Record, or by itself once you are in a call: by default once you have been let in and someone else
is there, or as soon as you join if you choose that in the Options page. You can turn the automatic
start off there too.

**What the extension reads from the meeting page**

To know when you are in a call and what to name the file, it reads what the meeting page shows: the
page's title, the meeting code in its address, how many people are in the call, whether your
microphone is muted, and where the video tiles are. It reads no chat, no captions, no cookies, no
passwords, no other tabs and no browsing history.

**Where your data is kept**

Everything stays on your computer:

- **The recording files** are saved in your Downloads folder, in a `zen-recorder` folder unless you
  change that in the Options page. What happens to them after that is up to you. Firefox also lists
  them among your downloads.
- **A recording in progress** is kept in the extension's storage in your browser profile
  (IndexedDB), a piece every few seconds, so that a crash loses nothing. Saving the file goes
  through a scratch file in the same storage. The pieces and the scratch file are deleted once the
  file is saved. When a save fails, the pieces stay until you press **Retry save** or remove the
  recording in the popup.
- **The list of recent recordings** in the popup keeps, for each recording, the meeting's title and
  code, the service, when it started and ended, its size and status, the file's name and the name of
  the microphone recorded. An entry stays until you remove it in the popup.
- **Your settings** and **the Diagnostics log** are kept in the extension's storage. The log holds
  the last 400 technical events, such as a recording starting or a file being saved, with the files'
  names.

Firefox deletes all of the extension's storage when you remove the add-on. It does not delete the
recording files.

**What the extension sends**

Nothing. The extension makes no network requests of its own, and its manifest declares that it
collects no data, which Firefox shows when you install it.

The meeting service still runs the call as it always does. Zen Recorder changes nothing about what
Google, Zoom or Microsoft receive.

Copies installed from the project's GitHub Releases check for a new version once a day: Firefox
downloads a small file, `updates.json`, from the project's site on GitHub Pages. Like any page your
browser loads, that request shows your IP address and browser version to GitHub, under GitHub's own
privacy statement. The project keeps no logs of it. Copies installed from addons.mozilla.org are
updated by Firefox through Mozilla instead.

**The Diagnostics log**

The log never leaves your browser by itself. The popup's **Diagnostics** button copies it to your
clipboard, and only when you press it. The log names your recordings' files, and so the titles of
your meetings: read it before you share it, for example in a bug report.

**The other people in the call**

Recording other people can require their consent, and many places require the consent of everyone in
the call. The meeting services may show the others no sign that you are recording. Telling them, and
following the law where you and they are, is up to you.

**Changes to this policy**

The policy is kept with the source code, in `docs/store/privacy.md`, and published on this page. A
version of the extension that stores or sends anything new changes this policy first, and the change
is visible in the project's history.

**Questions**

Open an issue at https://github.com/zenfully-org/zen-recorder/issues. For something you would rather
not discuss in public, follow the project's security policy, which explains how to report privately:
https://github.com/zenfully-org/zen-recorder/security/policy.
