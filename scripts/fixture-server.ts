/**
 * Tiny static server for the fake meeting pages. The path decides which provider's page is served
 * (`/zoom/…` → fake-zoom.html, `/teams/…` → fake-teams.html, anything else → fake-meet.html, the
 * same routing the content scripts use), so every URL of a provider looks like a page of that
 * service. `/fake-peer.html` is the shared remote participant.
 *
 * Every meeting page also comes with a report-only Content Security Policy that forbids eval and
 * requires Trusted Types, as Meet's and Teams' policies do, and sends its reports back here:
 * `GET /csp-reports` lists what a service with such a policy would have been told. It blocks
 * nothing, so the pages behave as they would without it. A `<meta>` policy could not do this: it
 * applies only once the parser reaches it, after the extension's scripts ran at document start,
 * and it cannot name a report URL.
 * Usage: `tsx scripts/fixture-server.ts` (or imported by the e2e script). Port: FIXTURE_PORT (4173).
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProviderCatalog } from '../src/lib/providers/get-provider-catalog';
import { resolveFixtureProvider } from '../src/lib/providers/resolve-fixture-provider';

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures',
);
/** Files every fake page shares, and their types. */
const SHARED_FILES = new Map([
  ['/fake-peer.html', 'text/html; charset=utf-8'],
  ['/page-observer.js', 'text/javascript; charset=utf-8'],
]);
const CSP_REPORTS_PATH = '/csp-reports';
const REPORT_ONLY_POLICY = `script-src 'self' 'unsafe-inline' blob:; require-trusted-types-for 'script'; report-uri ${CSP_REPORTS_PATH}`;

/** A report the browser sent, as received: `body` is the JSON text of the report. */
export interface ReceivedCspReport {
  receivedAt: number;
  body: string;
}

function fixtureFileFor(pathname: string): string | null {
  if (SHARED_FILES.has(pathname)) return pathname.slice(1);
  const provider = resolveFixtureProvider(pathname, getProviderCatalog());
  return provider ? `fake-${provider.id}.html` : null;
}

export function startFixtureServer(
  port = Number(process.env['FIXTURE_PORT'] ?? 4173),
): Promise<Server> {
  const reports: ReceivedCspReport[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === CSP_REPORTS_PATH) {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        reports.push({ receivedAt: Date.now(), body });
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(reports));
      return;
    }
    const file = fixtureFileFor(url.pathname);
    try {
      if (!file) throw new Error('no provider owns this path');
      const body = await readFile(path.join(FIXTURE_DIR, file));
      res.writeHead(200, {
        'content-type': SHARED_FILES.get(url.pathname) ?? 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...(SHARED_FILES.has(url.pathname)
          ? {}
          : { 'content-security-policy-report-only': REPORT_ONLY_POLICY }),
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env['FIXTURE_PORT'] ?? 4173);
  void startFixtureServer(port).then(() => {
    console.log(`fixture: http://localhost:${port}/abc-defg-hij (Meet), /zoom/…, /teams/…`);
    console.log(`CSP reports of the meeting pages: http://localhost:${port}${CSP_REPORTS_PATH}`);
  });
}
