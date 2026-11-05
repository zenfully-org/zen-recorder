// @vitest-environment node
import { downloadFile } from './download-file';
import { createFakeFetchDeps } from './fake-fetch-deps';

const RELEASE =
  'https://download-installer.cdn.mozilla.net/pub/firefox/releases/159.0.1/linux-x86_64/en-US/firefox-159.0.1.tar.xz';
const GET = `fetch GET ${RELEASE}`;

/** An answer of `size` bytes whose headers announce `length`. */
const answer = (size: number, headers: Record<string, string>): Response =>
  new Response(new Uint8Array(size).fill(7), { headers });

interface Case {
  name: string;
  size: number;
  headers: Record<string, string>;
}

describe('downloadFile', () => {
  it.each<Case>([
    { name: 'as long as announced', size: 10, headers: { 'content-length': '10' } },
    { name: 'of a length nobody announced', size: 10, headers: {} },
    {
      // Compressed, the announced length is not the length of the bytes fetch hands over.
      name: 'decoded from a compressed answer',
      size: 8,
      headers: { 'content-length': '10', 'content-encoding': 'gzip' },
    },
  ])('returns the bytes of an answer $name', async ({ size, headers }) => {
    const deps = createFakeFetchDeps([answer(size, headers)]);

    await expect(downloadFile(RELEASE, deps)).resolves.toEqual(new Uint8Array(size).fill(7));
    expect(deps.events).toEqual([GET]);
  });

  it('downloads again when the answer arrived cut short', async () => {
    const deps = createFakeFetchDeps([
      answer(4, { 'content-length': '10' }),
      answer(10, { 'content-length': '10' }),
    ]);

    await expect(downloadFile(RELEASE, deps)).resolves.toEqual(new Uint8Array(10).fill(7));
    expect(deps.events).toEqual([
      GET,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${RELEASE}: cut short, 4 of 10 bytes`,
      'wait 3000',
      GET,
    ]);
  });

  it('gives up when every answer arrives cut short', async () => {
    const short = () => answer(4, { 'content-length': '10' });
    const deps = createFakeFetchDeps([short(), short(), short()]);

    await expect(downloadFile(RELEASE, deps)).rejects.toThrow(
      new Error(`attempt 3 of 3 failed: ${RELEASE}: cut short, 4 of 10 bytes`),
    );
    expect(deps.events.filter((event) => event === GET)).toHaveLength(3);
  });

  it('fails at once on a file that is not there (HTTP 404)', async () => {
    const deps = createFakeFetchDeps([new Response('Not Found', { status: 404 })]);

    await expect(downloadFile(RELEASE, deps)).rejects.toThrow(new Error(`${RELEASE}: HTTP 404`));
    expect(deps.events).toEqual([GET]);
  });
});
