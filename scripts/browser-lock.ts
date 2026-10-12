/**
 * Runs a command under the machine's browser lock, on Linux, macOS and Windows: for browser work
 * the project's own runs do not cover, such as a Firefox driven by hand on the fixture pages
 * while other working copies run their tests. It waits for the lock as a run does, holds it while
 * the command runs, and exits with the command's code. A run of the project the command starts
 * (`pnpm browser-lock pnpm test:e2e`) goes on under it without waiting for its own lock.
 * Usage: pnpm browser-lock <command> [arguments…]
 */
import { spawn } from 'node:child_process';
import { holdBrowserLock } from './browser-lock/hold-browser-lock';

const words = process.argv.slice(2);
if (words[0] === '--') words.shift();
const [command, ...args] = words;
if (command === undefined) {
  console.error('usage: pnpm browser-lock <command> [arguments…]');
  process.exit(2);
}
await holdBrowserLock(words.join(' '));
// Windows starts `pnpm` and other `.cmd` files through its shell only, which reads one line: a
// word with a space or one of its special characters goes in double quotes.
const quoteForCmd = (word: string): string =>
  /[\s"&|<>^]/.test(word) ? `"${word.replaceAll('"', '\\"')}"` : word;
const child =
  process.platform === 'win32'
    ? spawn(words.map(quoteForCmd).join(' '), { stdio: 'inherit', shell: true })
    : spawn(command, args, { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`browser lock: could not run ${command}: ${error.message}`);
  process.exit(127);
});
child.on('exit', (code) => process.exit(code ?? 1));
