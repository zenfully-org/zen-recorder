/**
 * Keeps the meeting page's audio graph running before anything records. Firefox runs one audio
 * graph per window, sample rate and output device, and a new context runs only once its graph has
 * opened the audio device: up to 1.8 s on the lab's audio server when the page has no audio stream
 * open yet, a few milliseconds when one already runs. A recording's mixer that started the graph
 * itself lost that much of the meeting. While held, this keeps one silent context of the mixer's
 * sample rate open, so the mixer joins a graph that already runs.
 *
 * Nothing is connected to the context: the page plays nothing through it, and Firefox treats it
 * as inaudible. A context the browser would block (no click or capture in the page yet) is not
 * created, since it would only stay suspended and warn in the page's console; the caller holds
 * again when that may have changed.
 */

/** The part of an `AudioContext` the warm-up uses. */
export interface WarmContext {
  readonly state: AudioContextState;
  addEventListener(type: 'statechange', listener: () => void): void;
  close(): Promise<void>;
}

export interface AudioWarmupDeps {
  /** A context of the mixer's sample rate and output device, so both share one graph. */
  createContext: () => WarmContext;
  /** Whether the browser lets a new context start now (`canStartAudioContext`). */
  canStart: () => boolean;
  /** Milliseconds, for the time the graph took to run. */
  now: () => number;
  onLog: (level: 'info' | 'warn', message: string) => void;
}

export interface AudioWarmup {
  /**
   * Keeps the graph running (`true`: the page is a meeting) or lets it go. Cheap to call often:
   * while held without a context it checks again whether one may start.
   */
  hold(wanted: boolean): void;
}

export function createAudioWarmup(deps: AudioWarmupDeps): AudioWarmup {
  let context: WarmContext | null = null;
  /** Set once the hold has been reported as waiting, or a context failed: said once per hold. */
  let waiting = false;
  let failed = false;

  const open = (): void => {
    if (!deps.canStart()) {
      if (!waiting) {
        deps.onLog(
          'info',
          'audio warm-up: waiting until the page may play audio (a click, or the microphone in use)',
        );
      }
      waiting = true;
      return;
    }
    try {
      const opened = deps.createContext();
      const openedAt = deps.now();
      let reported = false;
      opened.addEventListener('statechange', () => {
        if (reported || opened.state !== 'running') return;
        reported = true;
        deps.onLog(
          'info',
          `audio warm-up: the audio graph runs after ${Math.round(deps.now() - openedAt)} ms`,
        );
      });
      context = opened;
    } catch (error) {
      failed = true;
      deps.onLog(
        'warn',
        `audio warm-up failed: ${String(error)}; a recording starts the audio graph itself`,
      );
    }
  };

  return {
    hold(wanted) {
      if (wanted) {
        if (!context && !failed) open();
        return;
      }
      waiting = false;
      failed = false;
      const closing = context;
      context = null;
      closing?.close().catch(() => undefined);
    },
  };
}
