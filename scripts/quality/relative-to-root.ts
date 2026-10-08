/** A path relative to the repository root with forward slashes, on Windows too, for keys that are the same on every machine. */
export function relativeToRoot(file: string, root: string): string {
  const normalized = file.replaceAll('\\', '/');
  const base = root.replaceAll('\\', '/').replace(/\/$/, '');
  return normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized;
}
