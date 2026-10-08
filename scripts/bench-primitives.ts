/**
 * Runs the primitives benchmark page (`scripts/bench/zen-perf.html`) in the test Firefox and saves
 * its results: what drawImage from a WebRTC video or a worker-owned canvas, `new VideoFrame`,
 * WebGL2 compositing and each WebCodecs encoder cost on this machine. The same file opened by hand
 * in Zen on Windows measures the real target.
 * Usage: flock ../.browser.lock pnpm bench:primitives
 *   (Firefox instances on one machine disturb each other's timing: the lock, in the folder that
 *   holds the working copies side by side, lets one run at a time)
 * Env: BENCH_LABEL (result file name in .e2e/bench/), E2E_HEADLESS=0 to watch.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, ROOT, selectAudioServer, sleep, waitFor } from './e2e/harness';

async function main(): Promise<void> {
  selectAudioServer();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`  [page] ${message.text()}`);
    });
    await page.goto(pathToFileURL(path.join(ROOT, 'scripts/bench/zen-perf.html')).toString());
    console.log(`secure context: ${String(await page.evaluate(() => window.isSecureContext))}`);
    await page.evaluate(
      'void window.__zenPerfRun().catch((e) => { window.__zenPerfError = String(e.stack ?? e); })',
    );
    let last = '';
    const results = await waitFor(
      'primitives results',
      async () => {
        const progress = await page.evaluate(
          () => document.getElementById('out')?.textContent ?? '',
        );
        const line = progress.split('\n').at(-1) ?? '';
        if (line !== last && !line.startsWith('{') && !line.startsWith(' '))
          console.log(`  ${line}`);
        last = line;
        const error = await page.evaluate('window.__zenPerfError ?? null');
        if (typeof error === 'string') throw new Error(error);
        const done = await page.evaluate(
          'window.__zenPerfResults ? JSON.stringify(window.__zenPerfResults) : null',
        );
        return typeof done === 'string' ? done : null;
      },
      600_000,
    );
    await sleep(100);
    const outDir = path.join(ROOT, '.e2e/bench');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(
      outDir,
      `primitives-${process.env['BENCH_LABEL'] ?? 'run'}-${stamp}.json`,
    );
    await writeFile(out, results);
    console.log(results);
    console.log(`\nresults: ${path.relative(ROOT, out)}`);
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
