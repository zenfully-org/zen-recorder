// @vitest-environment node
import { expectEventually } from './expect-eventually';

/** A read that gives each value in turn, then the last one for good. */
function reads(...values: string[]): () => Promise<string | undefined> {
  let index = 0;
  return async () => values[Math.min(index++, values.length - 1)];
}

describe('expectEventually', () => {
  it('waits until the value turns into the expected one', async () => {
    const read = vi.fn(reads('finalizing', 'finalizing', 'saved'));

    await expectEventually('status of r1', read, 'saved', 1_000, 1);

    expect(read).toHaveBeenCalledTimes(3);
  });

  it('fails with the last value it read once the deadline has passed', async () => {
    await expect(
      expectEventually('status of r1', reads('finalizing'), 'saved', 30, 1),
    ).rejects.toThrow('status of r1: expected saved, got finalizing within 0.03 s');
  });
});
