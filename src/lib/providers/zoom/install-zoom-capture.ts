/**
 * Zoom's capture. The web client sends and receives media over data channels (or WebSockets where
 * WebRTC is switched off) and decodes it in WASM, so its peer connections carry no remote tracks:
 * the remote audio is the stream it plays through a detached `<audio>` element. The peer
 * connections still say whether the call is connected. The client closes them with `close()`,
 * which fires no event, so they are polled.
 *
 * Leaving is a page navigation about a second after the user confirmed it, with the meeting UI
 * unchanged until then. The capture therefore watches for the click on the confirmation button
 * and reports the call as left as soon as the connections are closed after it. Closed connections
 * alone are not the end: the client also drops and reopens them when the network hiccups.
 * Verified live in Firefox on 2026-10-01.
 *
 * The client's microphone test opens a second microphone and stops it again without an event; the
 * page session goes back to the microphone that is still open (`createMicWatcher`).
 */
import { combineCaptures } from '@/lib/capture/combine-captures';
import { installMediaElementCapture } from '@/lib/capture/install-media-element-capture';
import { installWebRtcCapture } from '@/lib/capture/install-web-rtc-capture';
import type { CaptureListener, MediaCapture } from '@/lib/providers/types';

/** "Leave Meeting" / "End Meeting for All" in the confirmation that follows the Leave button. */
const LEAVE_CONFIRMATION = 'leave-meeting-options__btn';
/** How long a confirmed leave counts. The client closes its connections within 0.2 s of it. */
const LEAVE_WINDOW_MS = 5_000;

export interface ZoomCapture extends MediaCapture {
  /** The user confirmed leaving and the call's connections are closed. */
  userLeft(): boolean;
}

export function installZoomCapture(
  win: Window & typeof globalThis,
  listener: CaptureListener,
  pollIntervalMs = 100,
): ZoomCapture {
  const peers = installWebRtcCapture(win, listener);
  const capture = combineCaptures([peers, installMediaElementCapture(win, listener)]);
  let connected = false;
  /** Peer connections carried the call: from then on only they say whether it is connected. */
  let everConnected = false;
  /** Poll ticks left in which a confirmed leave counts. */
  let leaveTicks = 0;

  const onClick = (event: Event): void => {
    const confirmed = event
      .composedPath()
      .some(
        (node) =>
          node instanceof win.HTMLButtonElement && node.classList.contains(LEAVE_CONFIRMATION),
      );
    if (!confirmed) return;
    leaveTicks = Math.ceil(LEAVE_WINDOW_MS / pollIntervalMs);
    listener.connectionsChanged();
  };
  win.document.addEventListener('click', onClick, true);

  const watchConnections = (): void => {
    const now = peers.anyConnected();
    everConnected ||= now;
    // A leave that did not happen (a host asked to name a new host first) is forgotten.
    const expired = leaveTicks > 0 && --leaveTicks === 0;
    if (now === connected && !expired) return;
    connected = now;
    listener.connectionsChanged();
  };
  const timer = win.setInterval(watchConnections, pollIntervalMs);
  return {
    ...capture,
    // The audio element keeps "playing" a dead stream after the call: once peer connections
    // carried the call, they alone say whether it is connected.
    anyConnected: () => peers.anyConnected() || (!everConnected && capture.anyConnected()),
    userLeft: () => leaveTicks > 0 && !peers.anyConnected(),
    uninstall() {
      win.clearInterval(timer);
      win.document.removeEventListener('click', onClick, true);
      leaveTicks = 0;
      capture.uninstall();
    },
  };
}
