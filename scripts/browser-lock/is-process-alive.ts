/**
 * Whether a process with this pid exists, on Linux, macOS and Windows: signal 0 checks without
 * sending anything. A process this user may not signal exists too (`EPERM`).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
