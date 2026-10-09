/**
 * The audio tap's AudioWorklet module: the name of its processor, its source, and the name of the
 * file the extension ships it as. A page loads it from a blob URL where its policy allows that, and
 * from the extension's file where it refuses blob and data URLs (Teams). The file is named after a
 * hash of the source: a recorder that outlived an update of the extension finds no file under its
 * old name and falls back, rather than run a module of another version. Imports nothing:
 * `wxt.config.ts` loads it to write the file.
 */
const PROCESSOR_NAME = 'zen-recorder-tap';
/** Frames per posted buffer (16 render quanta ≈ 43 ms at 48 kHz). */
const WORKLET_BUFFER_FRAMES = 2048;
/**
 * Messages the worklet posts before the page has taken them; beyond, it keeps the buffers and the
 * page's next answer brings all of them in one message. Four buffers are 171 ms of audio.
 */
const WORKLET_WINDOW = 4;

// The AudioWorklet API requires a processor class; it lives in this string, not in our bundle.
// It posts `{ frame, samples }`: `frame` is `currentFrame` at the first sample. A quantum without
// input channels is silence, so the tap's frames keep up with the graph's. The page answers each
// such message with `{ more: true }`; while `WORKLET_WINDOW` messages are unanswered, full buffers
// wait in `runs` (buffers that follow each other in the graph, joined), and the next answer lets
// each run go in one message. A message `{ flush: id }` makes it post every buffer, the partly
// filled one too, then `{ flushed: id }`.
const SOURCE = `
registerProcessor('${PROCESSOR_NAME}', (function () {
  return class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = new Float32Array(${WORKLET_BUFFER_FRAMES});
      this.filled = 0;
      this.start = 0;
      this.runs = [];
      this.unanswered = 0;
      this.port.onmessage = (event) => {
        if (event.data.more) {
          this.unanswered--;
          this.send(false);
          return;
        }
        this.keep();
        this.send(true);
        this.port.postMessage({ flushed: event.data.flush });
      };
    }
    keep() {
      if (this.filled === 0) return;
      const samples = this.buffer.slice(0, this.filled);
      const last = this.runs[this.runs.length - 1];
      if (last && last.frame + last.length === this.start) {
        last.parts.push(samples);
        last.length += samples.length;
      } else {
        this.runs.push({ frame: this.start, length: samples.length, parts: [samples] });
      }
      this.filled = 0;
    }
    send(all) {
      if (this.runs.length === 0 || (!all && this.unanswered >= ${WORKLET_WINDOW})) return;
      for (const run of this.runs) {
        const out = new Float32Array(run.length);
        let at = 0;
        for (const part of run.parts) {
          out.set(part, at);
          at += part.length;
        }
        this.port.postMessage({ frame: run.frame, samples: out }, [out.buffer]);
        this.unanswered++;
      }
      this.runs = [];
    }
    process(inputs, outputs) {
      const frames = outputs[0][0].length;
      if (this.filled === 0) this.start = currentFrame;
      const channel = inputs[0] && inputs[0][0];
      if (channel) this.buffer.set(channel, this.filled);
      else this.buffer.fill(0, this.filled, this.filled + frames);
      this.filled += frames;
      if (this.filled >= ${WORKLET_BUFFER_FRAMES}) {
        this.keep();
        this.send(false);
      }
      return true;
    }
  };
})());
`;

export interface AudioTapWorklet {
  processorName: string;
  source: string;
  /** The file's name in the extension, at its root. */
  file: string;
}

/** FNV-1a, 32 bits, over UTF-16 code units: enough to tell two sources apart in a file name. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function audioTapWorklet(): AudioTapWorklet {
  return {
    processorName: PROCESSOR_NAME,
    source: SOURCE,
    file: `audio-tap-worklet-${hashOf(SOURCE)}.js`,
  };
}
