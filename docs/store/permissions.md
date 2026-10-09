# Permissions

What Zen Recorder asks Firefox for, and why. addons.mozilla.org's reviewers get this text with
each submission, and it is here for anyone deciding whether to install the extension.

The extension makes no network requests of its own: no `fetch`, no `XMLHttpRequest`, no
WebSocket, no beacon. None of the permissions below is used to send anything anywhere.

`src/lib/project/get-manifest-permissions.ts` lists the API permissions the manifest asks for,
and the provider catalog (`src/lib/providers/get-provider-catalog.ts`) lists the sites. A test
fails when this file and the manifest disagree.

## API permissions

### `storage`

Keeps the settings of the Options page and the Diagnostics log in `storage.local`. Neither leaves
the browser, and `storage.local` is not synced to other devices.

### `unlimitedStorage`

A recording in progress is kept in the extension's IndexedDB as it is recorded, a piece every few
seconds, so that a crashed tab or browser loses nothing. With video, an hour takes about 1.1 GB.
Saving the file then goes through a scratch file in the extension's origin-private file system
(OPFS), which holds a second copy for a moment. Without this permission Firefox caps the
extension's storage at a share of the disk, and a long meeting would stop fitting. The pieces and
the scratch file are deleted once the file is saved.

### `downloads`

Saves each recording as a file in the Downloads folder (`downloads.download`, into a
`zen-recorder` folder by default), waits until Firefox has finished writing it
(`downloads.search`), and lets the popup show a saved file in its folder: it finds the file in
Firefox's download list by its path (`downloads.search`) and shows it (`downloads.show`), or opens
the download folder when Firefox no longer lists the file, as after a restart
(`downloads.showDefaultFolder`).

### `notifications`

Shows "Meeting recording saved" (or "recovered") with the file's name once a file is saved.
Recordings stop and save on their own when a call ends, so this is how the person recording
learns where the file went.

### `alarms`

Half a minute after the extension starts, an alarm runs the recovery pass: a recording whose tab
crashed, or whose browser closed in the middle of a meeting, is saved from the pieces kept in
IndexedDB. An alarm wakes the extension's background page even when Firefox has suspended it in
the meantime, which a timer does not.

## Host permissions

| Site | Service | Why |
| --- | --- | --- |
| `https://meet.google.com/*` | Google Meet | the meeting pages of Google Meet |
| `https://*.zoom.us/*` | Zoom | the web client ("Join from browser"); Zoom serves it from several subdomains, such as `app.zoom.us` and `us05web.zoom.us` |
| `https://teams.microsoft.com/*` | Microsoft Teams | Teams for work or school |
| `https://teams.live.com/*` | Microsoft Teams | Teams for personal accounts |
| `https://teams.cloud.microsoft/*` | Microsoft Teams | the newer address of Teams for work or school |

On these sites, and nowhere else, two content scripts run from `document_start`:

- **The hook**, in the page's own world (`world: "MAIN"`). It wraps `getUserMedia` and
  `RTCPeerConnection`, and on Zoom the audio elements the page plays, so that the recorder gets
  the meeting's audio and video tracks. It records them in the page: the audio through an
  `AudioWorklet`, the video through WebCodecs, both into WebM with the Mediabunny library. It
  passes the recorded pieces to the bridge with `postMessage`. It has to run in the page's world
  and before the page's own scripts, because the tracks exist only there.
- **The bridge**, in the extension's isolated world. It passes the pieces and the recording's
  state to the extension's background page, which stores them and saves the file.

To know when you are in a call, the scripts read what the meeting page shows: its title (for the
file's name), the meeting code from its address, how many people are in the call, whether your
microphone is muted, and the video tiles on screen. They read no chat, no captions and no
cookies, and they send nothing anywhere.

Firefox lets you turn each site off (`about:addons` → Zen Recorder → Permissions). The popup then
offers **Grant access** for it.

## Other manifest keys

- `commands`: the keyboard shortcut (Alt+Shift+R by default) that starts or stops the recording
  of the active tab. It asks Firefox which tab is active
  (`tabs.query({ active: true, currentWindow: true })`) and reads only the tab's id. That needs no
  permission: `tabs` would only add the address, title and icon of every tab, which nothing reads.
- `browser_specific_settings.gecko.data_collection_permissions`: `{ "required": ["none"] }`. The
  extension collects and transmits no data.
- `granted_host_permissions: true`: grants the host permissions to a temporary install
  (`about:debugging`, the project's end-to-end run). Firefox ignores it for an installed add-on,
  which asks for the sites as usual.

The extension loads no remote code. Every script it runs is in the XPI, built from the sources as
[`README-REVIEWERS.md`](../../README-REVIEWERS.md) describes.
