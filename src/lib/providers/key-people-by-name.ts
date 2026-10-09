/**
 * Keys for people a page tells apart by their display names only: `name:<name>`, and for the
 * second and third person of one name `name:<name>#2`, `#3`, in page order. A name stays the same
 * when its tile is mounted again or its camera is switched, which a tile's own id does not.
 */
export function keyPeopleByName<T extends { name: string }>(
  people: readonly T[],
): (T & { key: string })[] {
  const taken = new Set<string>();
  return people.map((person) => {
    const base = `name:${person.name}`;
    let key = base;
    let repeat = 1;
    while (taken.has(key)) {
      repeat++;
      key = `${base}#${repeat}`;
    }
    taken.add(key);
    return { ...person, key };
  });
}
