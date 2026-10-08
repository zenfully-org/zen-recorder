/**
 * The errors a step wrote as GitHub workflow commands (`::error file=…,line=…::message`), which
 * GitHub already shows as annotations: Vitest's github-actions reporter writes one per failing
 * test, and a step can write its own. A Vitest title is the test's file and name joined by ` > `.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const PREFIX = '::error';
/** Enough of a message to tell what went wrong; the rest is in the step's log. */
const MAX_LINES = 12;

/** Undoes the escaping of workflow commands (`%25`, `%0D`, `%0A`, and `%3A`, `%2C` in properties). */
function decode(text: string): string {
  return text.replace(/%(25|0D|0A|3A|2C)/gi, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  );
}

function readProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const pair of text.split(',')) {
    const equals = pair.indexOf('=');
    if (equals > 0) properties.set(pair.slice(0, equals), decode(pair.slice(equals + 1)));
  }
  return properties;
}

/** The message without Vitest's pointer to the line (`❯ file:line:col`), the place says it. */
function shorten(message: string): string {
  const lines = message.split('\n').filter((line) => !/^\s*❯ /.test(line));
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop();
  return lines.slice(0, MAX_LINES).join('\n');
}

const toNumber = (text: string | undefined): number | null =>
  text === undefined ? null : Number(text);

/** `::error <properties>::<message>`; the properties are escaped, so they hold no `::`. */
function readCommand(line: string): { properties: Map<string, string>; message: string } | null {
  const next = line.charAt(PREFIX.length);
  if (!line.startsWith(PREFIX) || (next !== ' ' && next !== ':')) return null;
  const end = line.indexOf('::', PREFIX.length);
  if (end < 0) return null;
  return {
    properties: readProperties(line.slice(PREFIX.length, end).trim()),
    message: decode(line.slice(end + 2)),
  };
}

function toFailure(properties: Map<string, string>, message: string, root: string): StepFailure {
  const where = properties.get('file');
  const file = where?.startsWith(`${root}/`) ? where.slice(root.length + 1) : (where ?? null);
  const title = properties.get('title') ?? null;
  const test =
    file !== null && title?.startsWith(`${file} > `) ? title.slice(file.length + 3) : null;
  return makeFailure({
    tool: test === null ? 'annotation' : 'vitest',
    message: shorten(message),
    file,
    line: toNumber(properties.get('line')),
    column: toNumber(properties.get('col') ?? properties.get('column')),
    rule: test === null ? title : null,
    test,
  });
}

export function extractAnnotations(log: string, root: string): StepFailure[] {
  return log.split('\n').flatMap((line) => {
    const command = readCommand(line);
    return command ? [toFailure(command.properties, command.message, root)] : [];
  });
}
