The add-on has a new id, `zen-recorder@zenfully-org.github.io`, which names the project.
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
