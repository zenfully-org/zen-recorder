# Security policy

Zen Recorder keeps recordings of meetings on the user's own disk and sends nothing anywhere. A
security problem is anything that breaks that promise. Report it privately, as described below,
and never in a public issue.

## Supported versions

Only the latest release gets security fixes. The browser installs a new release by itself within a
day; check that you run the latest one (`about:addons` → Zen Recorder) before you report.

## How to report

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to the
[reporting form](https://github.com/zenfully-org/zen-recorder/security/advisories/new). Only the
maintainer sees the report.

Include:

- the Zen Recorder version, the browser and its version, and the meeting service if one is
  involved;
- the steps to reproduce, and what an attacker gains;
- a proof of concept if you have one.

Do not attach recordings or Diagnostics logs of real meetings: they hold other people's voices,
faces and names. Make a test meeting instead.

## What counts

- A web page, a meeting service or another extension that can read, change, move or delete a
  recording, the pieces of a recording kept while it runs, or the Diagnostics log.
- A web page that can run code in the extension: its background page, its popup or its Options
  page.
- Anything that sends a recording, its metadata or the Diagnostics log off the machine.

These do not count:

- A bug that loses or damages a recording without an attacker. That is a bug: open an issue.
- That the recorder gives the other people in a call no sign that they are being recorded. This is
  how a local recorder works; the README asks users to tell the people in their call.

## What happens next

The maintainer answers within seven days, as a best effort: the project has one maintainer and no
company behind it. The fix ships in a release, and the release notes credit you unless you ask
them not to. There is no bug bounty.
