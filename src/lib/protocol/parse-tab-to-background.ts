import { z } from 'zod';
import { parseChunkMessage } from '@/lib/protocol/parse-chunk-message';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseRecordingEnded } from '@/lib/protocol/parse-recording-ended';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import type { TabToBackground } from '@/lib/types';

const envelope = z.object({ type: z.string() }).loose();

/** Validates a Port message from a Meet tab to the background; null when malformed. */
export function parseTabToBackground(input: unknown): TabToBackground | null {
  const env = envelope.safeParse(input);
  if (!env.success) return null;
  const data = env.data;
  switch (data.type) {
    case 'hello':
    case 'snapshot': {
      const snapshot = parseTabSnapshot(data['snapshot']);
      return snapshot ? { type: data.type, snapshot } : null;
    }
    case 'recordingStarted': {
      const info = parseRecordingStarted(data['info']);
      return info ? { type: 'recordingStarted', info } : null;
    }
    case 'chunk': {
      const chunk = parseChunkMessage(data['chunk']);
      return chunk ? { type: 'chunk', chunk } : null;
    }
    case 'recordingEnded': {
      const info = parseRecordingEnded(data['info']);
      return info ? { type: 'recordingEnded', info } : null;
    }
    case 'log': {
      const log = parsePageLog(data['log']);
      return log ? { type: 'log', log } : null;
    }
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}
