#!/usr/bin/env bash
# The packages CI's end-to-end jobs need beyond the runner image: ffmpeg and ffprobe, which read
# the saved recordings, and PulseAudio with its libraries, for the audio server of
# scripts/test-audio.sh and for Firefox's audio output.
#
# apt-get took about 25 s per job (the package index, then 104 packages downloaded and unpacked),
# and minutes when a mirror was slow. The workflow keeps the downloaded .deb files in a cache keyed
# by the runner image's version: with them, this installs straight from the folder, about 7 s,
# most of it dpkg unpacking. Without them (a new image, a changed package list), apt-get downloads
# them into the folder first, for the workflow to save.
#
# Usage: scripts/ci/install-e2e-packages.sh <folder for the .deb files>
set -euo pipefail

DEBS="$(mkdir -p "$1" && cd "$1" && pwd -P)"
# Xvfb and xauth come with the image today; named so that an image without them still works.
PACKAGES=(ffmpeg pulseaudio xvfb xauth)

if ! compgen -G "$DEBS/*.deb" >/dev/null; then
  mkdir -p "$DEBS/partial"
  sudo apt-get update
  sudo apt-get install --yes --no-install-recommends --download-only \
    -o Dir::Cache::archives="$DEBS" "${PACKAGES[@]}"
  sudo rm -rf "$DEBS/partial" "$DEBS/lock"
fi

# The same install on a hit and a miss. Unsafe I/O skips dpkg's sync after every file: nothing on
# a runner outlives the job.
if compgen -G "$DEBS/*.deb" >/dev/null; then
  sudo dpkg --force-unsafe-io --install "$DEBS"/*.deb
fi
