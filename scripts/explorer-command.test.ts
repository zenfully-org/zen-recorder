// @vitest-environment node
import { explorerCommand } from './explorer-command';

const FOLDER = '/work/zen-recorder/.output/firefox-mv3';

describe('explorerCommand', () => {
  it('opens the folder itself on Windows', () => {
    const windowsPathOf = vi.fn(() => null);
    expect(
      explorerCommand('C:\\zen-recorder\\.output\\firefox-mv3', {
        platform: 'win32',
        windowsPathOf,
      }),
    ).toEqual({
      program: 'explorer.exe',
      args: ['C:\\zen-recorder\\.output\\firefox-mv3'],
    });
    expect(windowsPathOf).not.toHaveBeenCalled();
  });

  it("opens the folder's Windows path inside WSL2", () => {
    const windowsPathOf = vi.fn(() => 'W:\\zen-recorder\\.output\\firefox-mv3');
    expect(explorerCommand(FOLDER, { platform: 'linux', windowsPathOf })).toEqual({
      program: 'explorer.exe',
      args: ['W:\\zen-recorder\\.output\\firefox-mv3'],
    });
    expect(windowsPathOf).toHaveBeenCalledWith(FOLDER);
  });

  it('opens nothing anywhere else', () => {
    expect(explorerCommand(FOLDER, { platform: 'darwin', windowsPathOf: () => null })).toBeNull();
  });
});
