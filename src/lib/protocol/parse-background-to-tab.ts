import { z } from 'zod';
import { parseLifecycleCommand } from '@/lib/protocol/parse-lifecycle-command';
import { parseSettings } from '@/lib/settings/parse-settings';
import type { BackgroundToTab } from '@/lib/types';

const ackSchema = z.object({ recordingId: z.string(), seq: z.number().int().nonnegative() });
const endAckSchema = z.object({ recordingId: z.string() });
const savedSchema = z.object({
  recordingId: z.string(),
  filename: z.string(),
  chunkCount: z.number().int().nonnegative(),
  byteSize: z.number().nonnegative(),
});
const errorSchema = z.object({ recordingId: z.string().nullable(), message: z.string() });
const envelope = z.object({ type: z.string() }).loose();

/** Validates a Port message from the background to a Meet tab; null when malformed. */
export function parseBackgroundToTab(input: unknown): BackgroundToTab | null {
  const env = envelope.safeParse(input);
  if (!env.success) return null;
  const data = env.data;
  switch (data.type) {
    case 'ack': {
      const ack = ackSchema.safeParse(data);
      return ack.success ? { type: 'ack', ...ack.data } : null;
    }
    case 'endAck': {
      const endAck = endAckSchema.safeParse(data);
      return endAck.success ? { type: 'endAck', ...endAck.data } : null;
    }
    case 'command': {
      const command = parseLifecycleCommand(data['command']);
      return command ? { type: 'command', command } : null;
    }
    case 'settings':
      return { type: 'settings', settings: parseSettings(data['settings']) };
    case 'saved': {
      const saved = savedSchema.safeParse(data);
      return saved.success ? { type: 'saved', ...saved.data } : null;
    }
    case 'error': {
      const error = errorSchema.safeParse(data);
      return error.success ? { type: 'error', ...error.data } : null;
    }
    default:
      return null;
  }
}
