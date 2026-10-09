import { z } from 'zod';
import type { BackgroundPort } from '@/lib/messaging/create-background-port';
import { parseMeetingEventBatch } from '@/lib/protocol/parse-meeting-event-batch';

/** Only to count what a batch it cannot read held. */
const eventsShape = z.object({ events: z.array(z.unknown()) });

/**
 * Relays a batch of the page's meeting events to the background, and answers the page once it is
 * stored. It never fails for what the batch holds: a batch it cannot read, or one with no event it
 * knows, is answered at once (`rejected` counts what it dropped), since the page sends a batch the
 * bridge refuses again and again. Only a background that cannot take it fails, and the page then
 * sends it again. The log says how many, never what.
 */
export async function relayEvents(
  data: unknown,
  port: Pick<BackgroundPort, 'sendEvents'>,
  log: (line: string) => void,
): Promise<{ ok: true; rejected: number }> {
  const parsed = parseMeetingEventBatch(data);
  if (!parsed) {
    const shape = eventsShape.safeParse(data);
    const count = shape.success ? shape.data.events.length : 0;
    log(`meeting events: a batch it cannot read (${count} events) is not forwarded`);
    return { ok: true, rejected: count };
  }
  if (parsed.rejected > 0) {
    log(`meeting events: ${parsed.rejected} event(s) of a batch cannot be read`);
  }
  if (parsed.batch.events.length > 0) await port.sendEvents(parsed.batch);
  return { ok: true, rejected: parsed.rejected };
}
