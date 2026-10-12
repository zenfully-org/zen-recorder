import { type AudioSample, AudioSampleSource } from 'mediabunny';
import { vi } from 'vitest';

/**
 * Records the audio an encoder hands its muxer (`AudioSampleSource.add`), in file order, as runs
 * of one sample value rounded to 0.01: a test feeds audio of a few values and reads back where each
 * went (0 is silence the encoder wrote in). Call `restore()` when done.
 */
export function recordAudioTimeline() {
  const runs: [number, number][] = [];
  let largest = 0;
  const add = AudioSampleSource.prototype.add;
  const spy = vi.spyOn(AudioSampleSource.prototype, 'add').mockImplementation(function (
    this: AudioSampleSource,
    sample: AudioSample,
  ) {
    const data = new Float32Array(sample.numberOfFrames);
    sample.copyTo(data, { planeIndex: 0, format: 'f32' });
    largest = Math.max(largest, sample.numberOfFrames);
    for (const value of data) {
      const key = Math.round(value * 100) / 100;
      const last = runs[runs.length - 1];
      if (last && last[0] === key) last[1] += 1 / sample.sampleRate;
      else runs.push([key, 1 / sample.sampleRate]);
    }
    return add.call(this, sample);
  });
  const rounded = (seconds: number) => Math.round(seconds * 100) / 100;
  return {
    /** [value, seconds] in file order, seconds rounded to 10 ms. */
    runs: () => runs.map(([value, seconds]) => [value, rounded(seconds)]),
    /** Seconds of `value` in all, rounded to 10 ms. */
    seconds: (value: number) =>
      rounded(runs.reduce((sum, [key, seconds]) => (key === value ? sum + seconds : sum), 0)),
    /** Frames in the largest sample handed over. */
    largest: () => largest,
    restore: () => spy.mockRestore(),
  };
}
