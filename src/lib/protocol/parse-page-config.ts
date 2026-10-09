import { z } from 'zod';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { PageConfig } from '@/lib/types';

const defaults = getDefaultSettings();

/** Every field is optional on the way in and defaulted, so the output is a complete `PageConfig`. */
const schema = z.object({
  // A bridge older than meeting events says nothing: the page then sends it none.
  eventsProtocol: z.number().int().nonnegative().default(0),
  bridgeId: z.string().max(64).default(''),
  autoRecord: z.boolean().default(defaults.autoRecord),
  startRule: z.enum(['firstRemote', 'onJoin']).default(defaults.startRule),
  audioBitsPerSecond: z.number().int().min(8_000).max(512_000).default(defaults.audioBitsPerSecond),
  timesliceMs: z.number().int().min(500).max(60_000).default(defaults.timesliceMs),
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
 * Validates the configuration the bridge pushes into the page (`bridge:configure`). Missing fields
 * take the factory default and an invalid message falls back to the defaults entirely, so a bad
 * message can never break the recorder.
 */
export function parsePageConfig(input: unknown): PageConfig {
  const result = schema.safeParse(input);
  return result.success ? result.data : schema.parse({});
}
