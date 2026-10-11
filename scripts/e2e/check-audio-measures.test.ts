// @vitest-environment node
/**
 * Runs where ffmpeg is installed. CI's gate has none; the e2e jobs, which have it, run the same
 * check before their first scenario.
 */
import { spawnSync } from 'node:child_process';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { assertAudioMeasuresWork } from './check-audio-measures';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

// The check writes a file with ffmpeg and measures it with ffmpeg, several processes.
describe.runIf(hasFfmpeg)('assertAudioMeasuresWork', { timeout: PROCESS_BUDGET_MS }, () => {
  it("passes: the audio measures read the seconds before a file's first video frame", () => {
    expect(() => assertAudioMeasuresWork()).not.toThrow();
  });
});
