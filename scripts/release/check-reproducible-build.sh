#!/usr/bin/env bash
# Rebuilds the extension from a sources zip in an empty folder, with the commands
# README-REVIEWERS.md gives addons.mozilla.org's reviewers, and compares the build with an XPI
# file by file. The reviewers do the same with every submission, and their build must not differ.
#
# Usage: scripts/release/check-reproducible-build.sh <XPI> <sources zip>
#
# The environment reaches the build: `ZEN_RECORDER_CHANNEL=self` rebuilds the self-distributed XPI.
# Mozilla's signature (META-INF/) is left out of the comparison, so a signed XPI can be checked
# too. Needs corepack (part of Node.js 24), unzip and diff. Exit status: 0 the same, 1 the build
# failed or differs, 2 usage or a file it cannot read.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <XPI> <sources zip>" >&2
  exit 2
fi
for file in "$1" "$2"; do
  if [[ ! -f $file || ! -r $file ]]; then
    echo "check-reproducible-build: cannot read $file" >&2
    exit 2
  fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q "$1" -d "$work/xpi"
rm -rf "$work/xpi/META-INF"
unzip -q "$2" -d "$work/sources"

# corepack asks before it downloads the pnpm version package.json names; there is nobody to ask.
if ! (
  cd "$work/sources"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack pnpm install --frozen-lockfile
  corepack pnpm build
) >"$work/build.log" 2>&1; then
  tail -n 40 "$work/build.log" >&2
  echo "check-reproducible-build: the build from the sources failed" >&2
  exit 1
fi

build="$work/sources/.output/firefox-mv3"
if ! diff -rq "$work/xpi" "$build" >"$work/diff.txt"; then
  echo "check-reproducible-build: the build from the sources differs from the XPI:" >&2
  sed -e "s#$work/xpi#XPI#g" -e "s#$build#build#g" "$work/diff.txt" >&2
  exit 1
fi
echo "check-reproducible-build: the build from the sources equals the XPI ($(find "$build" -type f | wc -l | tr -d ' ') files)"
