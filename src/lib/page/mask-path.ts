/**
 * A page address's path with every letter as `a` and every digit as `0`, the rest kept: the shape
 * of an address, which says where in the path a service puts what, without the meeting code, a
 * name or a passcode the path may hold. Diagnostics get pasted into public bug reports.
 */
export function maskPath(pathname: string): string {
  return pathname.replace(/\p{L}/gu, 'a').replace(/\p{N}/gu, '0');
}
