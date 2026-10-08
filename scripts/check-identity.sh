#!/usr/bin/env bash
# Fails when a file of the working tree names the maintainer or points into one machine (a home
# folder, a Windows user folder, a WSL share). The project goes public from a rewritten history,
# and the rewrite only has to fix old blobs if the current tree is already clean.
#
# Usage: pnpm check:identity
#
# The patterns are POSIX extended regular expressions, one per line, matched case-insensitively;
# blank lines and lines starting with `#` are ignored. They are not in the public repository (they
# would name what they look for): the file is $IDENTITY_PATTERNS, by default
# .internal/private/rewrite/patterns.txt in the maintainer's internal folder, which a working copy
# links as `.internal` and git ignores. Without it the check fails rather than check nothing.
#
# It reads every tracked file and every new file git does not ignore, the lockfile, binaries and
# where symbolic links point included. A match is reported as `path:line` only, so the output never
# repeats what it found (it may end up in a public CI log).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

patterns_file="${IDENTITY_PATTERNS:-.internal/private/rewrite/patterns.txt}"
if [[ ! -f "$patterns_file" ]]; then
  echo "check-identity: no patterns file at $patterns_file (set IDENTITY_PATTERNS)" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# An empty pattern matches every line, so blank and comment lines never reach grep.
grep -v -E '^[[:space:]]*(#|$)' "$patterns_file" >"$work/patterns" || true
if [[ ! -s "$work/patterns" ]]; then
  echo "check-identity: no pattern in $patterns_file" >&2
  exit 2
fi

# search <output file> <git grep options>; git grep's exit status 1 only means "no match".
search() {
  local output="$1" status=0
  shift
  git grep "$@" -z -i -E -f "$work/patterns" --untracked -- . \
    >"$output" || status=$?
  if ((status > 1)); then
    echo "check-identity: git grep failed" >&2
    exit 2
  fi
}

search "$work/lines" -n -I
search "$work/text-files" -l -I
search "$work/files" -l

{
  # A text match is: path NUL line NUL content newline.
  while IFS= read -r -d '' file && IFS= read -r -d '' line && IFS= read -r _; do
    printf '%s:%s\n' "$file" "$line"
  done <"$work/lines"
  # A binary file has no line to point at.
  comm -z -23 <(sort -z "$work/files") <(sort -z "$work/text-files") |
    while IFS= read -r -d '' file; do printf '%s (binary)\n' "$file"; done
  # A symbolic link holds where it points, and git grep does not read it.
  git ls-files -z --cached --others --exclude-standard -- . |
    while IFS= read -r -d '' file; do
      if [[ -L "$file" ]] && readlink -- "$file" | grep -q -i -E -f "$work/patterns"; then
        printf '%s (symlink)\n' "$file"
      fi
    done
} >"$work/matches"

if [[ ! -s "$work/matches" ]]; then
  echo "check-identity: clean"
  exit 0
fi

lines=$(($(wc -l <"$work/matches")))
files=$(($(sed -E 's/(:[0-9]+| \((binary|symlink)\))$//' "$work/matches" | sort -u | wc -l)))
echo "check-identity: $lines lines in $files files name the maintainer or a machine:"
cat "$work/matches"
exit 1
