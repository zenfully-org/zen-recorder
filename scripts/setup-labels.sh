#!/usr/bin/env bash
# Creates the labels issues are triaged with on a GitHub repository, or updates the colour and
# description of those that exist, so every copy of the repository uses the same set. It never
# deletes or renames a label. CONTRIBUTING.md ("How issues are triaged") says what each one means;
# the issue forms in .github/ISSUE_TEMPLATE/ put `needs-triage` on every new issue.
#
# Usage: scripts/setup-labels.sh [--repo OWNER/NAME]
#
# Without --repo it works on the repository of the current folder, as the GitHub CLI picks it. It
# needs `gh`, logged in to an account that may create labels there (write access or more). It stops
# at the first label GitHub refuses. Exit status: 0 done, 1 a label was refused, 2 usage.
set -euo pipefail

usage() {
  echo "usage: $0 [--repo OWNER/NAME]" >&2
  exit 2
}

repo=()
case $# in
0) ;;
2) [[ $1 == --repo && -n $2 ]] || usage; repo=(--repo "$2") ;;
*) usage ;;
esac

# name|colour|description. GitHub's defaults first, with their own colours and descriptions.
labels="\
bug|d73a4a|Something isn't working
documentation|0075ca|Improvements or additions to documentation
duplicate|cfd3d7|This issue or pull request already exists
enhancement|a2eeef|New feature or request
good first issue|7057ff|Good for newcomers
help wanted|008672|Extra attention is needed
invalid|e4e669|This doesn't seem right
question|d876e3|Further information is requested
wontfix|ffffff|This will not be worked on
accessibility|f143ab|Barrier affecting people with disabilities
needs-triage|d4c5f9|New: the maintainer has not read it yet
accepted|c2e0c6|The maintainer accepted it: work can start
needs-maintainer|fbca04|Parked: only the maintainer can decide or test this
open-source|0e8a16|Publishing Zen Recorder as an independent open-source project
meeting-notes|1d76db|Meeting notes: a Markdown file with participants and a timeline next to every recording
provider:meet|00832d|Concerns Google Meet
provider:zoom|0b5cff|Concerns Zoom
provider:teams|5b5fc7|Concerns Microsoft Teams
dependencies|0366d6|Pull requests that update a dependency file"

count=0
while IFS='|' read -r name color description; do
  if ! gh label create "$name" --color "$color" --description "$description" --force "${repo[@]}"; then
    echo "setup-labels: could not create or update \"$name\"" >&2
    exit 1
  fi
  count=$((count + 1))
done <<<"$labels"
echo "setup-labels: $count labels created or updated on ${repo[1]:-the current repository}"
