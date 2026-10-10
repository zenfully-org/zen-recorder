/**
 * Downloads a version's signed XPI from addons.mozilla.org once AMO approved it: the release's
 * publish mode finishes a release whose signing timed out (AMO held the version for a review)
 * with it, so nobody has to fetch the file from the Developer Hub by hand. It asks AMO's API for
 * the version (`readAmoVersion`) with the release environment's API key, and downloads the file
 * only when AMO made it public, on the release's channel.
 *
 * Usage: tsx scripts/release/fetch-signed-xpi.ts --version <x.y.z> --channel <listed|unlisted> --out <file>
 * Env: WEB_EXT_API_KEY, WEB_EXT_API_SECRET (the JWT issuer and secret of the AMO API key).
 * Exit status: 0 written, 1 not ready or refused (an error annotation says why), 2 usage or a
 * request that failed.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { getAddOnId } from '../../src/lib/get-add-on-id';
import { escapeCommandData } from '../ci/escape-command-data';
import { createAmoJwt } from './create-amo-jwt';
import { readAmoVersion } from './read-amo-version';

const API = 'https://addons.mozilla.org/api/v5/addons/addon';

function fail(message: string, status: 1 | 2): never {
  const line = `fetch-signed-xpi: ${message}`;
  console.log(`::error::${escapeCommandData(line)}`);
  process.exit(status);
}

const { values } = parseArgs({
  options: { version: { type: 'string' }, channel: { type: 'string' }, out: { type: 'string' } },
});
const issuer = process.env['WEB_EXT_API_KEY'];
const secret = process.env['WEB_EXT_API_SECRET'];
if (!values.version || !values.channel || !values.out) {
  fail('usage: --version <x.y.z> --channel <listed|unlisted> --out <file>', 2);
}
if (!issuer || !secret) fail('WEB_EXT_API_KEY and WEB_EXT_API_SECRET must be set', 2);

const authorization = (): string =>
  `JWT ${createAmoJwt({ issuer, secret, nowSeconds: Math.floor(Date.now() / 1000), id: randomUUID() })}`;

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { Authorization: authorization() } });
  if (!response.ok) fail(`GET ${url} answered ${response.status}`, 2);
  return response;
}

const versionUrl = `${API}/${encodeURIComponent(getAddOnId())}/versions/${encodeURIComponent(values.version)}/`;
const reading = readAmoVersion(await (await get(versionUrl)).json(), {
  version: values.version,
  channel: values.channel,
});
if (!reading.ready) fail(reading.reason, 1);
const xpi = Buffer.from(await (await get(reading.url)).arrayBuffer());
writeFileSync(values.out, xpi);
console.log(`fetch-signed-xpi: ${values.out} (${xpi.length} bytes) from ${reading.url}`);
