/**
 * Prints dependency-cruiser's JSON report (cruise-files.ts) on the files its standard input names,
 * a JSON list of paths relative to the root. check-quality.ts runs this file as a child process
 * with the files git lists, so the cruise (about a second) runs while ESLint lints in the parent.
 * The list goes in on standard input because it is long: a Windows command line holds at most
 * 32,767 characters. On a failure it prints the message to standard error and exits with 1.
 * Usage: `node --import tsx scripts/quality/cruise-imports.ts < files.json`.
 */
import path from 'node:path';
import { z } from 'zod';
import { cruiseFiles } from './cruise-files';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FILES = z.array(z.string());

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const files = FILES.parse(JSON.parse(await readStdin()));
  process.stdout.write(await cruiseFiles(ROOT, files));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
