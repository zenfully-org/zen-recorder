/**
 * The encoder's audio on its way to the muxer, in file order. Mediabunny writes a sample, then waits
 * for the encoder's queue (its `dequeue` event reaches the page as a task), so a page busy with long
 * tasks writes only a few samples a second, and one write per tap buffer fell behind for as long as
 * the load lasted: a Stop waited for all of it. So audio added while earlier audio is still being
 * written waits, and what waits goes to the muxer in one sample when its turn comes.
 *
 * Only audio that follows on in the file is joined, at the same rate: a silence (a gap the media
 * clock fills) or audio that does not follow starts a sample of its own, so every part keeps the
 * place the clock gave it. Silence is made a second at a time when its turn comes, so a long stop
 * costs no memory.
 */

export interface AudioQueue {
  /** Adds `data` at `timestamp` seconds into the file. */
  audio(data: Float32Array, rate: number, timestamp: number): void;
  /** Adds `frames` of silence at `timestamp` seconds into the file. */
  silence(frames: number, rate: number, timestamp: number): void;
  /** Seconds of audio added and not written yet. */
  pendingSeconds(): number;
  /** Resolves once everything added so far was written, or failed. */
  idle(): Promise<void>;
}

/** Audio waiting for its turn: parts that follow each other, written as one sample. */
interface Waiting {
  parts: Float32Array[];
  rate: number;
  /** The file frame of the first part, and how many frames the parts hold. */
  start: number;
  frames: number;
}

export function createAudioQueue(deps: {
  /** Writes one sample; called one at a time, in file order. */
  write(data: Float32Array, rate: number, timestamp: number): Promise<void>;
  onError(error: unknown): void;
}): AudioQueue {
  let chain: Promise<void> = Promise.resolve();
  let waiting: Waiting | null = null;
  let pending = 0;
  const run = (step: () => Promise<void>): void => {
    chain = chain.then(step).catch(deps.onError);
  };
  return {
    audio(data, rate, timestamp) {
      pending += data.length / rate;
      const start = Math.round(timestamp * rate);
      if (waiting?.rate === rate && waiting.start + waiting.frames === start) {
        waiting.parts.push(data);
        waiting.frames += data.length;
        return;
      }
      const next: Waiting = { parts: [data], rate, start, frames: data.length };
      waiting = next;
      run(async () => {
        if (waiting === next) waiting = null;
        const joined = new Float32Array(next.frames);
        let at = 0;
        for (const part of next.parts) {
          joined.set(part, at);
          at += part.length;
        }
        try {
          await deps.write(joined, rate, timestamp);
        } finally {
          pending -= next.frames / rate;
        }
      });
    },
    silence(frames, rate, timestamp) {
      // What waits before the gap is written before it, on its own.
      waiting = null;
      run(async () => {
        for (let done = 0; done < frames; done += rate) {
          const length = Math.min(rate, frames - done);
          await deps.write(new Float32Array(length), rate, timestamp + done / rate);
        }
      });
    },
    pendingSeconds: () => pending,
    idle: () => chain,
  };
}
