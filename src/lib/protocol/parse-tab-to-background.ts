import { z } from 'zod';
import { parseChunkMessage } from '@/lib/protocol/parse-chunk-message';
import { parseMeetingEventBatch } from '@/lib/protocol/parse-meeting-event-batch';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseRecordingEnded } from '@/lib/protocol/parse-recording-ended';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import type { TabToBackground } from '@/lib/types';

const envelope = z.object({ type: z.string() }).loose();
/**
 * What a bridge adds to a page's log line: when it got it and its number. A bridge older than
 * them sends neither, and a malformed one is left out rather than costing the line.
 */
const logExtras = z
  .object({
    at: z.number().optional(),
    receipt: z.object({ bridge: z.string(), seq: z.number().int().nonnegative() }).optional(),
  })
  .catch({});

type Reader = (data: Record<string, unknown>) => TabToBackground | null;

/** One reader per message type: what it carries goes through that payload's own parser. */
const readers = new Map<string, Reader>([
  [
    'hello',
    (data) => {
      const snapshot = parseTabSnapshot(data['snapshot']);
      return snapshot ? { type: 'hello', snapshot } : null;
    },
  ],
  [
    'snapshot',
    (data) => {
      const snapshot = parseTabSnapshot(data['snapshot']);
      return snapshot ? { type: 'snapshot', snapshot } : null;
    },
  ],
  [
    'recordingStarted',
    (data) => {
      const info = parseRecordingStarted(data['info']);
      return info ? { type: 'recordingStarted', info } : null;
    },
  ],
  [
    'chunk',
    (data) => {
      const chunk = parseChunkMessage(data['chunk']);
      return chunk ? { type: 'chunk', chunk } : null;
    },
  ],
  [
    'recordingEnded',
    (data) => {
      const info = parseRecordingEnded(data['info']);
      return info ? { type: 'recordingEnded', info } : null;
    },
  ],
  [
    'events',
    (data) => {
      const parsed = parseMeetingEventBatch(data['batch']);
      return parsed && parsed.batch.events.length > 0
        ? { type: 'events', batch: parsed.batch }
        : null;
    },
  ],
  [
    'log',
    (data) => {
      const log = parsePageLog(data['log']);
      return log ? { type: 'log', log, ...logExtras.parse(data) } : null;
    },
  ],
  ['ping', () => ({ type: 'ping' })],
]);

/** Validates a Port message from a meeting tab to the background; null when malformed. */
export function parseTabToBackground(input: unknown): TabToBackground | null {
  const env = envelope.safeParse(input);
  if (!env.success) return null;
  return readers.get(env.data.type)?.(env.data) ?? null;
}
