import { z } from 'zod';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { Settings } from '@/lib/types';

const defaults = getDefaultSettings();

/** Every field is optional on the way in and defaulted, so the output is a complete `Settings`. */
const settingsSchema = z.object({
  autoRecord: z.boolean().default(defaults.autoRecord),
  startRule: z.enum(['firstRemote', 'onJoin']).default(defaults.startRule),
  audioBitsPerSecond: z.number().int().min(8_000).max(512_000).default(defaults.audioBitsPerSecond),
  timesliceMs: z.number().int().min(500).max(60_000).default(defaults.timesliceMs),
  filenameTemplate: z.string().trim().min(1).default(defaults.filenameTemplate),
  downloadSubfolder: z.string().default(defaults.downloadSubfolder),
  overlayEnabled: z.boolean().default(defaults.overlayEnabled),
  keepRawCopy: z.boolean().default(defaults.keepRawCopy),
  videoMode: z.enum(['off', 'tiles']).default(defaults.videoMode),
  videoFps: z.number().int().min(1).max(30).default(defaults.videoFps),
  videoHeight: z
    .union([z.literal(360), z.literal(540), z.literal(720), z.literal(1080)])
    .default(defaults.videoHeight),
  videoBitsPerSecond: z
    .number()
    .int()
    .min(300_000)
    .max(8_000_000)
    .default(defaults.videoBitsPerSecond),
  videoLabels: z.boolean().default(defaults.videoLabels),
  spoofVisibility: z.boolean().default(defaults.spoofVisibility),
});

/**
 * Turns untrusted input (storage contents, a message from the popup) into a complete Settings
 * object. Missing fields take their default; one invalid field rejects the whole input, which then
 * falls back to the defaults. Nothing throws.
 */
export function parseSettings(input: unknown): Settings {
  const result = settingsSchema.safeParse(input);
  return result.success ? result.data : getDefaultSettings();
}
