import { describe, expect, it } from 'vitest';
import { FIRST_PUBLIC_COMMIT, pickUpgradeBase } from './pick-upgrade-base';

const sha = (digit: string) => digit.repeat(40);

describe('pickUpgradeBase', () => {
  it('takes the first release tag `git ls-remote --sort=-v:refname` lists: the newest', () => {
    const listed = [
      `${sha('a')}\trefs/tags/v0.10.0`,
      `${sha('b')}\trefs/tags/v0.9.1`,
      `${sha('c')}\trefs/tags/v0.4.0`,
    ].join('\n');
    expect(pickUpgradeBase(listed)).toEqual({ commit: sha('a'), name: 'v0.10.0' });
  });

  it('skips tags that are no release: pre-releases and other names', () => {
    const listed = [
      `${sha('a')}\trefs/tags/v0.5.0-rc.1`,
      `${sha('b')}\trefs/tags/vnext`,
      `${sha('c')}\trefs/tags/v0.4.0`,
      '',
    ].join('\n');
    expect(pickUpgradeBase(listed)).toEqual({ commit: sha('c'), name: 'v0.4.0' });
  });

  it('stands in the first public commit while no release is tagged', () => {
    expect(pickUpgradeBase('')).toEqual({
      commit: FIRST_PUBLIC_COMMIT,
      name: 'the first public commit',
    });
    expect(FIRST_PUBLIC_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});
