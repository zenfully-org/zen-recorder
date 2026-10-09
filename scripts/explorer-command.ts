/** What opens a folder in Windows Explorer, from Windows itself or from inside WSL2. */
export interface ExplorerDeps {
  platform: NodeJS.Platform;
  /** The folder's Windows path (`wslpath -w` inside WSL2), or null where there is none. */
  windowsPathOf: (folder: string) => string | null;
}

/**
 * The command that opens `folder` in Windows Explorer: on Windows the folder itself, inside WSL2
 * its Windows path; anywhere else none.
 */
export function explorerCommand(
  folder: string,
  deps: ExplorerDeps,
): { program: string; args: string[] } | null {
  if (deps.platform === 'win32') return { program: 'explorer.exe', args: [folder] };
  const windowsPath = deps.windowsPathOf(folder);
  return windowsPath === null ? null : { program: 'explorer.exe', args: [windowsPath] };
}
