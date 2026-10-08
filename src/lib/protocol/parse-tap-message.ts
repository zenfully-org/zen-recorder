import { z } from 'zod';

/**
 * What the audio tap's worklet posts to the page: a buffer with the graph frame of its first
 * sample (`currentFrame`), or the answer to a drain request.
 */
export type TapMessage =
  | { type: 'samples'; data: Float32Array; frame: number }
  | { type: 'drained'; id: number };

const schema = z.union([
  z
    .object({ frame: z.number().int().nonnegative(), samples: z.instanceof(Float32Array) })
    .transform(({ frame, samples }) => ({ type: 'samples' as const, data: samples, frame })),
  z
    .object({ flushed: z.number().int() })
    .transform(({ flushed }) => ({ type: 'drained' as const, id: flushed })),
]);

/** Validates a message from the tap's AudioWorklet processor; null when malformed. */
export function parseTapMessage(input: unknown): TapMessage | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
