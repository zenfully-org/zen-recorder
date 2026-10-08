#!/usr/bin/env bash
# Prints the notes of one release: the lines of its section in CHANGELOG.md, from below the heading
# `## <version> - <date>` to the next `## ` heading, without the blank lines at either end. They
# are the notes of the version's GitHub Release, followed by the install steps. `Unreleased` prints
# what the next release holds so far.
#
# Usage: scripts/release-notes.sh <version> [changelog]
#
# The version is written as in the heading (`0.3.0`, not the tag `v0.3.0`) and matched exactly.
# Without a changelog it reads the repository's CHANGELOG.md, wherever it runs. Exit status: 0
# printed, 1 no section for that version or one without a line, 2 usage or an unreadable changelog.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || -z $1 ]]; then
  echo "usage: $0 <version> [changelog]" >&2
  exit 2
fi
version=$1
changelog=${2:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/CHANGELOG.md"}
if [[ ! -f $changelog || ! -r $changelog ]]; then
  echo "release-notes: cannot read $changelog" >&2
  exit 2
fi

# awk compares strings, so a dot in the version is a dot. Its exit status: 0 the section has lines,
# 3 no such section, 4 a section without a line.
status=0
notes="$(awk -v version="$version" '
  /^## / {
    if (found) exit
    heading = substr($0, 4)
    found = (heading == version || index(heading, version " - ") == 1)
    next
  }
  found {
    lines[++count] = $0
    if ($0 !~ /^[[:space:]]*$/) {
      if (!first) first = count
      last = count
    }
  }
  END {
    if (!found) exit 3
    if (!first) exit 4
    for (i = first; i <= last; i++) print lines[i]
  }
' "$changelog")" || status=$?

case $status in
0) printf '%s\n' "$notes" ;;
3)
  echo "release-notes: no section for $version in $changelog" >&2
  exit 1
  ;;
4)
  echo "release-notes: the section for $version in $changelog is empty" >&2
  exit 1
  ;;
*)
  echo "release-notes: awk failed on $changelog" >&2
  exit 2
  ;;
esac
