#!/usr/bin/env bash
# Publishes a release on the project site: the `gh-pages` branch, which GitHub Pages serves. The
# branch gets the files of `site/` (the install page and the privacy page) and `updates.json`, the
# update manifest that copies installed from a GitHub Release check once a day: the published one
# plus this release's entry (scripts/release/write-update-manifest.ts). The XPI must be the
# release's, signed by Mozilla, and the build of the channel addons.mozilla.org signed it on, or
# nothing is published: on `unlisted` the self-distributed build (ZEN_RECORDER_CHANNEL=self), which
# names this update manifest; on `listed` the build that names none, so a copy that updates to it
# updates from addons.mozilla.org afterwards.
#
# Usage: scripts/release/update-pages.sh --channel <listed|unlisted> [--remote <name or URL>]
#          [--site <folder>] <version> <signed XPI> <update link>
#
# The version is written as in package.json (`0.4.0`); the update link is the HTTPS address the XPI
# is downloaded from, the release's asset. The remote defaults to `origin`, the site to the
# repository's `site/`. The branch is created on the first release. Pushing uses the git
# credentials of the environment. Exit status: 0 published (or already there), 1 refused or the
# push failed, 2 usage or a file it cannot read.
set -euo pipefail

usage() {
  echo "usage: $0 --channel <listed|unlisted> [--remote <name or URL>] [--site <folder>]" \
    "<version> <signed XPI> <update link>" >&2
  exit 2
}

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
remote=origin
site="$repo/site"
branch=gh-pages
channel=
while [[ $# -gt 0 && $1 == --* ]]; do
  [[ $# -ge 2 ]] || usage
  case $1 in
  --channel) channel=$2 ;;
  --remote) remote=$2 ;;
  --site) site=$2 ;;
  *) usage ;;
  esac
  shift 2
done
[[ $# -eq 3 && ($channel == listed || $channel == unlisted) ]] || usage
version=$1
xpi=$2
link=$3
if [[ ! -f $xpi || ! -r $xpi ]]; then
  echo "update-pages: cannot read $xpi" >&2
  exit 2
fi
if [[ ! -d $site ]]; then
  echo "update-pages: cannot read the site folder $site" >&2
  exit 2
fi
xpi="$(cd "$(dirname "$xpi")" && pwd)/$(basename "$xpi")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pages="$work/pages"
git init --quiet --initial-branch="$branch" "$pages"
# `ls-remote --exit-code` exits 2 when the branch does not exist yet, other codes on errors.
status=0
git -C "$pages" ls-remote --quiet --exit-code "$remote" "refs/heads/$branch" >/dev/null || status=$?
case $status in
0)
  git -C "$pages" fetch --quiet --depth=1 "$remote" "refs/heads/$branch"
  git -C "$pages" reset --quiet --hard FETCH_HEAD
  ;;
2) echo "update-pages: $branch does not exist yet, publishing the first release" ;;
*)
  echo "update-pages: cannot read $branch from $remote" >&2
  exit 1
  ;;
esac

previous=()
if [[ -f $pages/updates.json ]]; then
  cp "$pages/updates.json" "$work/previous.json"
  previous=(--previous "$work/previous.json")
fi
# The branch mirrors the site folder: a page removed from it leaves the site too.
find "$pages" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$site/." "$pages/"
# Plain files: no Jekyll build on GitHub's side.
touch "$pages/.nojekyll"
# One Node process with tsx's loader: the `tsx` command starts a second one around it. Node resolves
# `--import tsx` from the working directory, hence the repository's. Every path given is absolute.
(cd "$repo" && node --import tsx scripts/release/write-update-manifest.ts \
  --channel "$channel" --xpi "$xpi" --version "$version" --update-link "$link" \
  --out "$pages/updates.json" "${previous[@]}")

git -C "$pages" add --all
if git -C "$pages" rev-parse --quiet --verify HEAD >/dev/null &&
  git -C "$pages" diff --cached --quiet; then
  echo "update-pages: $branch already has $version: nothing to publish"
  exit 0
fi
git -C "$pages" \
  -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  -c commit.gpgsign=false \
  commit --quiet --message "Release $version: the site and the update manifest"
git -C "$pages" push --quiet "$remote" "HEAD:refs/heads/$branch"
echo "update-pages: published $version on $branch"
