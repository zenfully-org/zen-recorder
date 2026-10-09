/**
 * Checks, before the e2e run starts, that its audio measures (`toneLevel`, `meanVolume`) read the
 * span they are given. A recording's video can start seconds after its audio (a page that stalls,
 * a recording started before the call), and ffmpeg asked to seek its input lands on a video key
 * frame: the seconds of audio before it were not measured at all ("Output file is empty"). The
 * check builds such a file, a 1 kHz tone from 0 s with video only from 3 s, and measures before
 * and after the video starts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { meanVolume, toneLevel } from './harness';

/** The tone is generated at half scale, about -9 dBFS RMS; anything louder than this is the tone. */
const TONE_FLOOR_DB = -30;

/** A WebM with a 1 kHz tone from 0 to 6 s and video only from 3 s to 6 s. */
function writeLateVideoFile(file: string): void {
  const run = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-v', 'error'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=6'],
      ...['-f', 'lavfi', '-i', 'color=c=gray:size=64x64:rate=15:duration=3'],
      ...['-filter_complex', '[1:v]setpts=PTS+3/TB[video]', '-map', '0:a', '-map', '[video]'],
      ...['-c:a', 'libopus', '-b:a', '64k', '-c:v', 'libvpx', '-b:v', '200k', '-f', 'webm', file],
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`ffmpeg could not write the check's file: ${run.stderr}`);
}

/**
 * Throws, naming each measure that missed, unless both read the tone in the seconds before the
 * file's first video frame and after it. Needs ffmpeg with libopus and libvpx.
 */
export function assertAudioMeasuresWork(): void {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'zen-recorder-audio-check-'));
  try {
    const file = path.join(folder, 'late-video.webm');
    writeLateVideoFile(file);
    const spans: [string, number, number][] = [
      ['before the first video frame', 0, 2],
      ['after it', 3.5, 5.5],
    ];
    const misses = spans.flatMap(([where, fromS, toS]) => {
      const read = (measure: () => number | null): string => {
        try {
          return String(measure());
        } catch (error) {
          return error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
        }
      };
      const tone = read(() => toneLevel(file, 1000, fromS, toS));
      const mean = read(() => meanVolume(file, fromS, toS));
      return [
        ...(Number(tone) > TONE_FLOOR_DB
          ? []
          : [`toneLevel ${where} (${fromS}-${toS} s): ${tone}`]),
        ...(Number(mean) > TONE_FLOOR_DB
          ? []
          : [`meanVolume ${where} (${fromS}-${toS} s): ${mean}`]),
      ];
    });
    if (misses.length > 0) {
      throw new Error(
        `the e2e run's audio measures miss a 1 kHz tone that plays from 0 s (expected above ${TONE_FLOOR_DB} dBFS): ${misses.join('; ')}`,
      );
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
