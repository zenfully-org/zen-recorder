import { describe, expect, it } from 'vitest';
import { keyPeopleByName } from './key-people-by-name';

const keys = (names: string[]) =>
  keyPeopleByName(names.map((name) => ({ name }))).map(({ key }) => key);

describe('keyPeopleByName', () => {
  it('keys each person by their display name and keeps what else they carry', () => {
    expect(
      keyPeopleByName([
        { name: 'Ana Souza', self: true },
        { name: 'Ben Carter', self: false },
      ]),
    ).toEqual([
      { name: 'Ana Souza', self: true, key: 'name:Ana Souza' },
      { name: 'Ben Carter', self: false, key: 'name:Ben Carter' },
    ]);
  });

  it('numbers the second and third person of one name in page order', () => {
    expect(keys(['Ana', 'Ben', 'Ana', 'Ana'])).toEqual([
      'name:Ana',
      'name:Ben',
      'name:Ana#2',
      'name:Ana#3',
    ]);
  });

  it('never gives two people one key, even when a name looks like a numbered one', () => {
    expect(keys(['Ana#2', 'Ana', 'Ana'])).toEqual(['name:Ana#2', 'name:Ana', 'name:Ana#3']);
  });

  it('keys nobody on an empty page', () => {
    expect(keys([])).toEqual([]);
  });
});
