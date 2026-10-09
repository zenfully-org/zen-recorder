/** How many times something happened, in words: "once", "twice", "3 times". */
export function countTimes(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}
