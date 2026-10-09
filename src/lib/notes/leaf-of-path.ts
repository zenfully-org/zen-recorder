/** The last part of a path, split on `/` and `\`: a file's name without the folders before it. */
export function leafOfPath(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}
