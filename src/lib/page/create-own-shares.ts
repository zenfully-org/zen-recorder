/**
 * Whether the user shares a screen from the meeting page, for the meeting notes: a share starts
 * when the browser hands the page its screen (`getDisplayMedia`, through the hook `watch`
 * installs), and ends with its last screen. The browser fires `ended` when the user stops the
 * share from its own controls, but a page's own `track.stop()` fires nothing, so the state of the
 * screens is read each time it is asked (every tick).
 */

/** A shared screen, as far as the notes need it. */
type Screen = Pick<MediaStreamTrack, 'readyState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Installs the page's share hook through `watch` (which returns its uninstall, null where the page
 * cannot share); `onChange` when a share starts, or the browser ended a screen.
 */
export function createOwnShares<Track extends Screen>(
  watch: ((onScreen: (screen: Track) => void) => (() => void) | null) | undefined,
  onChange: () => void,
) {
  const screens = new Set<Track>();
  const uninstall =
    watch?.((screen) => {
      screens.add(screen);
      screen.addEventListener('ended', onChange);
      onChange();
    }) ?? null;

  return {
    /** The user shares a screen now; null where the recorder cannot see the page share. */
    active(): boolean | null {
      if (uninstall === null) return null;
      for (const screen of [...screens]) {
        if (screen.readyState === 'ended') screens.delete(screen);
      }
      return screens.size > 0;
    },
    dispose(): void {
      uninstall?.();
      for (const screen of screens) screen.removeEventListener('ended', onChange);
      screens.clear();
    },
  };
}
