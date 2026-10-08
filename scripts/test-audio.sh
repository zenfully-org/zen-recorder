#!/usr/bin/env bash
# A private PulseAudio server with a null sink for the test browsers.
#
# Firefox only runs its audio graph (AudioContext, MediaRecorder, the recorder's mixer) when it can
# open an audio output. Under WSL2 that output is WSLg's PulseAudio server, which can wedge
# ("Connection refused") and then every AudioContext stays suspended: recordings have no audio and
# the e2e scenarios fail in confusing ways. This server needs no root and touches nothing
# system-wide; the e2e run uses it automatically when it is up (see scripts/e2e/harness.ts).
#
# A workaround for Linux, WSL2 above all: a desktop Firefox on macOS or Windows plays through the
# system's own audio and needs none of this. `setup` takes PulseAudio from the package manager of
# Debian and Ubuntu (apt-get download, no install).
#
# Usage: scripts/test-audio.sh setup    download and unpack PulseAudio into .tools/pulse (once)
#        scripts/test-audio.sh start    start the server (no-op when it already answers)
#        scripts/test-audio.sh status   print "running: <PULSE_SERVER value>" (exit 0) or "stopped" (exit 1)
#        scripts/test-audio.sh stop
# Browsers started by hand use it through: PULSE_SERVER=unix:$XDG_RUNTIME_DIR/zen-recorder-pulse/native
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
DIR="$(cd "$ROOT/.tools" && pwd -P)/pulse"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SOCKET_DIR="${RUNTIME_DIR%/}/zen-recorder-pulse"
SOCKET="$SOCKET_DIR/native"

answers() { PULSE_SERVER="unix:$SOCKET" timeout 5 pactl info >/dev/null 2>&1; }

case "${1:-start}" in
  setup)
    mkdir -p "$DIR/debs" "$DIR/root"
    (cd "$DIR/debs" && apt-get download pulseaudio libspeexdsp1)
    for deb in "$DIR"/debs/*.deb; do dpkg -x "$deb" "$DIR/root"; done
    echo "unpacked into $DIR/root"
    ;;
  start)
    if answers; then echo "running: unix:$SOCKET"; exit 0; fi
    [ -x "$DIR/root/usr/bin/pulseaudio" ] || { echo "run '$0 setup' first" >&2; exit 1; }
    MODULES="$(echo "$DIR"/root/usr/lib/pulse-*/modules)"
    LIBS="$DIR/root/usr/lib/x86_64-linux-gnu"
    mkdir -p "$SOCKET_DIR" "$DIR/run" "$DIR/state"
    rm -f "$SOCKET"
    # Without a session bus: a second PulseAudio cannot take the org.PulseAudio1 name and would exit.
    env DBUS_SESSION_BUS_ADDRESS=disabled: \
      LD_LIBRARY_PATH="$LIBS/pulseaudio:$LIBS:$MODULES" \
      PULSE_RUNTIME_PATH="$DIR/run" PULSE_STATE_PATH="$DIR/state" \
      nohup "$DIR/root/usr/bin/pulseaudio" -n --daemonize=no --exit-idle-time=-1 \
        --use-pid-file=no --system=no --realtime=no --high-priority=no -p "$MODULES" \
        -L "module-null-sink sink_name=zen_recorder_null" \
        -L "module-native-protocol-unix socket=$SOCKET auth-anonymous=1" \
        --log-target="file:$DIR/pulse.log" >/dev/null 2>&1 &
    echo $! > "$DIR/pid"
    for _ in $(seq 1 50); do answers && { echo "running: unix:$SOCKET"; exit 0; }; sleep 0.2; done
    echo "the server did not come up; see $DIR/pulse.log" >&2
    exit 1
    ;;
  status)
    if answers; then echo "running: unix:$SOCKET"; else echo "stopped"; exit 1; fi
    ;;
  stop)
    [ -f "$DIR/pid" ] && kill "$(cat "$DIR/pid")" 2>/dev/null || true
    rm -f "$DIR/pid" "$SOCKET"
    echo "stopped"
    ;;
  *)
    echo "usage: $0 setup|start|status|stop" >&2
    exit 2
    ;;
esac
