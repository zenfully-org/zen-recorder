import { describe, expect, it } from 'vitest';
import { AUDIO_START_WAIT_MS, createAudioStartWatch } from './create-audio-start-watch';

/** A recording as the watch reads it: its id, where its file is, and whether its audio started. */
function recording(id: string, mediaMs: number, audio: boolean | null) {
  return {
    id,
    encoder: { mediaTimeMs: () => mediaMs },
    video: audio === null ? null : { audioStarted: () => audio },
  };
}

function setup() {
  const lines: string[] = [];
  const watch = createAudioStartWatch({
    log: (level, message) => lines.push(`${level}: ${message}`),
  });
  return { watch, lines };
}

describe('createAudioStartWatch', () => {
  it('waits 5 s of the file, 2.5 times the latest first audio measured on a slow machine', () => {
    expect(AUDIO_START_WAIT_MS).toBe(5_000);
  });

  it.each([
    ['nothing records', null, {}],
    ['the audio started', recording('a', 60_000, true), {}],
    ['the file is not 5 s in yet', recording('a', 4_999, false), {}],
    ['the recording has no video', recording('a', 60_000, null), {}],
    ['the audio has not started 5 s in', recording('a', 5_000, false), { noAudio: true }],
  ] as const)('says %s', (_label, active, snapshot) => {
    const { watch } = setup();
    watch.check(active);
    expect(watch.snapshot(active?.id ?? null)).toEqual(snapshot);
  });

  it('writes one line per recording, whatever the number of checks', () => {
    const { watch, lines } = setup();
    for (const ms of [5_000, 6_000, 60_000]) watch.check(recording('a', ms, false));
    watch.check(recording('b', 5_000, false));
    expect(lines).toEqual([
      expect.stringMatching(
        /^warn: the audio has not started 5 s into the recording: the browser runs no audio in this tab/,
      ),
      expect.stringMatching(/^warn: the audio has not started 5 s into the recording/),
    ]);
  });

  it('stops saying it once the audio starts, and says nothing more of that recording', () => {
    const { watch, lines } = setup();
    watch.check(recording('a', 5_000, false));
    watch.check(recording('a', 7_000, true));
    expect(watch.snapshot('a')).toEqual({});
    watch.check(recording('a', 9_000, true));
    expect(lines).toHaveLength(1);
  });

  it('says it only of the recording it is about', () => {
    const { watch } = setup();
    watch.check(recording('a', 5_000, false));
    expect(watch.snapshot('b')).toEqual({});
    expect(watch.snapshot(null)).toEqual({});
    watch.check(null);
    expect(watch.snapshot('a')).toEqual({});
  });
});
