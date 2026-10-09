# Changelog entries for the next release

Each change the person recording notices adds one Markdown file here, in the folder of its group:
`added/`, `changed/`, `removed/` or `fixed/`. Name the file after the issue the pull request
closes, `fixed/72.md`, or after the pull request when there is no issue, and end the entry with
that number, `(#72)`. A pull request that changes two things writes two files.

Write the entry as it will read in [`CHANGELOG.md`](../CHANGELOG.md), without the leading `- `:
for the person recording, what they notice, and for a fix, what went wrong before. Wrap lines at
100 characters; the release indents them under the bullet.

`pnpm changelog` prints every entry as the next release's section will read. The release pull
request runs `pnpm changelog --release <version>`, which writes that section into the changelog
under `## Unreleased` and deletes these files. CONTRIBUTING.md, "The changelog and releases", has
the rest.
