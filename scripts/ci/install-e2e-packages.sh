#!/usr/bin/env bash
# The packages CI's end-to-end jobs need beyond the runner image: ffmpeg and ffprobe, which read
# the saved recordings, and PulseAudio with its libraries, for the audio server of
# scripts/test-audio.sh and for Firefox's audio output.
#
# apt-get took about 25 s per job (the package index, then 104 packages downloaded and unpacked).
# The workflow keeps the downloaded .deb files in a cache: with them, this installs straight from
# the folder, about 8 s, most of it dpkg unpacking. With none (these scripts changed, or the cache
# expired), apt-get downloads them into the folder first, for the workflow to save.
#
# The cache is kept per runner image, and GitHub ships a new image every few days: a job on an
# image without a cache gets the files of the newest image with one. They install on the next
# images as they are, but a newer image can ship a newer version of one of them, which a plain
# `dpkg --install` would downgrade, or lack a package an older image had, which then none of the
# files brings. So dpkg leaves alone what the image has in a newer version, and when the files do
# not install everything, apt-get downloads what is missing into the folder, which the workflow
# then saves for this image.
#
# apt-get gives up on a mirror that stops answering (the image sets a 15 s timeout and lists two
# more mirrors), never on one that answers slowly: on 2026-10-27 the runners' Azure mirror sent
# 53 kB/s, and the download took 21 minutes. So each apt-get call that downloads gets a minute
# and a half; past it, the image's next mirror goes first and apt-get starts again, keeping the
# files it has, until ten minutes are spent.
#
# Usage: scripts/ci/install-e2e-packages.sh <folder for the .deb files>
# Env, for tests: APT_MIRROR_LIST (the image's mirror list, /etc/apt/apt-mirrors.txt),
# APT_ATTEMPT_SECONDS (90), APT_BUDGET_SECONDS (600).
set -euo pipefail

DEBS="$(mkdir -p "$1" && cd "$1" && pwd -P)"
# Xvfb and xauth come with the image today; named so that an image without them still works.
PACKAGES=(ffmpeg pulseaudio xvfb xauth)
APT=(apt-get --yes --no-install-recommends -o Dir::Cache::archives="$DEBS")
MIRRORS="${APT_MIRROR_LIST:-/etc/apt/apt-mirrors.txt}"
ATTEMPT="${APT_ATTEMPT_SECONDS:-90}"
BUDGET="${APT_BUDGET_SECONDS:-600}"
DEADLINE=$((SECONDS + BUDGET))

# The image's mirror list (apt's mirror+file: a URL, a tab, priority:<n>, the lowest first) with
# its first mirror moved last: apt-get tries the next one first, and still has the slow one for a
# file the others lack. Prints what apt-get tries next.
next_mirror() {
  if [[ ! -f $MIRRORS ]]; then
    echo 'again'
    return
  fi
  local urls
  urls="$(grep -vE '^[[:space:]]*(#|$)' "$MIRRORS" | cut -f1)"
  { tail -n +2 <<<"$urls"; head -n 1 <<<"$urls"; } |
    awk '{ printf "%s\tpriority:%d\n", $0, NR }' | sudo tee "$MIRRORS" >/dev/null
  echo "next, $(head -n 1 "$MIRRORS" | cut -f1)"
}

# Runs apt-get with the attempt's time limit; past it, with the next mirror first, until the
# budget is spent.
apt_in_time() {
  local left limit status
  while :; do
    left=$((DEADLINE - SECONDS))
    if ((left <= 0)); then
      echo "::error title=Ubuntu's mirrors are slow::apt-get did not download ffmpeg and PulseAudio within $BUDGET s from any of the runner image's mirrors. Run the job again later."
      return 1
    fi
    limit=$((left < ATTEMPT ? left : ATTEMPT))
    status=0
    sudo timeout "$limit" "$@" || status=$?
    ((status == 124)) || return "$status"
    echo "apt-get did not finish within $limit s; $(next_mirror)"
  done
}

# The package index, read once: the files to download follow from it.
UPDATED=''
download() {
  mkdir -p "$DEBS/partial"
  [[ -n $UPDATED ]] || apt_in_time apt-get update
  UPDATED=1
  apt_in_time "${APT[@]}" install "$@"
}

status() { dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null || true; }

# Unsafe I/O skips dpkg's sync after every file: nothing on a runner outlives the job.
install_files() {
  ! compgen -G "$DEBS/*.deb" >/dev/null ||
    sudo dpkg --refuse-downgrade --skip-same-version --force-unsafe-io --install "$DEBS"/*.deb
}

all_installed() {
  local package
  for package in "${PACKAGES[@]}"; do
    [[ $(status "$package") == installed ]] || return 1
  done
}

if ! compgen -G "$DEBS/*.deb" >/dev/null; then
  download --download-only "${PACKAGES[@]}"
fi

if ! install_files || ! all_installed; then
  echo "The cached files did not install everything; apt-get downloads what is missing"
  # First the dependencies of what dpkg unpacked but could not configure: while some are
  # unconfigured, apt-get refuses a package name beside --fix-broken.
  download --fix-broken --download-only
  sudo "${APT[@]}" install --fix-broken --no-download
  # Then the packages dpkg knows nothing of. Naming one it installed would upgrade it.
  absent=()
  for package in "${PACKAGES[@]}"; do
    [[ $(status "$package") == installed ]] || absent+=("$package")
  done
  if ((${#absent[@]} > 0)); then
    download --download-only "${absent[@]}"
    sudo "${APT[@]}" install --no-download "${absent[@]}"
  fi
fi
sudo rm -rf "$DEBS/partial" "$DEBS/lock"
