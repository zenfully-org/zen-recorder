/**
 * The errors of Biome's default report (`biome check`): each diagnostic opens with a header line,
 * `file:line:col rule ━━━`, or `file rule ━━━` for the whole file (a format error), and says what
 * is wrong on its first line marked `×` (an error), followed by the code frame. `!` marks a
 * warning, which does not fail the check and is left out. A format error names no line: its
 * frame's first changed line, or first numbered line, is where the annotation goes.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const HEADER = /^(\S+?)(?::(\d+):(\d+))? (\S+)(?: {2}FIXABLE)? +━+$/;
const MARKED = /^ {2}([×!i]) (.*)$/;
const CHANGED_LINE = /^\s*(\d+)(?:\s+\d+)?\s+│ [-+]/;
const NUMBERED_LINE = /^>? *(\d+) /;
/** Enough of the code frame to see the problem; the rest is in the step's log. */
const FRAME_LINES = 10;

interface Diagnostic {
  header: RegExpExecArray;
  message: string;
  frame: string[];
}

const toNumber = (text: string | undefined): number | null =>
  text === undefined ? null : Number(text);

/** A frame ends at the next marked line, or at output that is not indented (a header, a total). */
const endsFrame = (line: string) => (line !== '' && !line.startsWith('  ')) || MARKED.test(line);

function toFailure({ header, message, frame }: Diagnostic): StepFailure {
  const [, file = null, line, column, rule = null] = header;
  const shown = frame.slice(0, FRAME_LINES);
  // A diff marks its changed lines with - and +; a short frame only underlines the change.
  const changed =
    shown.map((text) => CHANGED_LINE.exec(text)?.[1]).find(Boolean) ??
    shown.map((text) => NUMBERED_LINE.exec(text)?.[1]).find(Boolean);
  const first =
    rule === 'format' ? message.replace(/:$/, ' (pnpm check:fix formats the file):') : message;
  return makeFailure({
    tool: 'biome',
    message: [first, ...shown].join('\n'),
    file,
    line: toNumber(line ?? changed),
    column: toNumber(column),
    rule,
  });
}

interface State {
  /** The last header, until its first marked line. */
  header: RegExpExecArray | null;
  /** The error whose code frame is being read. */
  open: Diagnostic | null;
  failures: StepFailure[];
}

function close(state: State): void {
  if (state.open) state.failures.push(toFailure(state.open));
  state.open = null;
}

/** A line outside a code frame: a header, or a diagnostic's first marked line. */
function readOutsideFrame(state: State, line: string): void {
  const marked = MARKED.exec(line);
  if (state.header && marked) {
    if (marked[1] === '×') {
      state.open = { header: state.header, message: marked[2] ?? '', frame: [] };
    }
    // Only a diagnostic's first marked line says what it is; the others explain or suggest.
    state.header = null;
  } else {
    state.header = HEADER.exec(line) ?? state.header;
  }
}

export function extractBiomeErrors(log: string): StepFailure[] {
  const state: State = { header: null, open: null, failures: [] };
  for (const line of log.split('\n')) {
    if (state.open && !endsFrame(line)) {
      if (line.trim() !== '') state.open.frame.push(line.slice(2));
    } else {
      close(state);
      readOutsideFrame(state, line);
    }
  }
  close(state);
  return state.failures;
}
