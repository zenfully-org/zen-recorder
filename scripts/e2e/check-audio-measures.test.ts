// @vitest-environment node
/**
 * Runs where ffmpeg is installed. CI's gate has none; the e2e jobs, which have it, run the same
 * check before their first scenario.
 */
import { spawnSync } from 'node:child_process';
import { assertAudioMeasuresWork } from './check-audio-measures';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('assertAudioMeasuresWork', () => {
  it("passes: the audio measures read the seconds before a file's first video frame", () => {
    expect(() => assertAudioMeasuresWork()).not.toThrow();
  });
});
