/**
 * A scratch file in the origin-private file system used as a Mediabunny streaming target, so a
 * multi-GB remux never lives in the background page's heap. `file()` closes the writable (if the
 * muxer has not already) and returns the file-backed Blob; `discard()` removes the file.
 */

export interface OpfsStorage {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}

export interface OpfsScratchFile {
  writable: FileSystemWritableFileStream;
  file(): Promise<File>;
  discard(): Promise<void>;
}

export async function createOpfsScratchFile(deps: {
  storage: OpfsStorage;
  name: string;
}): Promise<OpfsScratchFile> {
  const root = await deps.storage.getDirectory();
  const handle = await root.getFileHandle(deps.name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await writable.close();
    } catch {
      // Already closed by the muxer (or errored): the data on disk is what matters.
    }
  };
  return {
    writable,
    async file() {
      await close();
      return handle.getFile();
    },
    async discard() {
      await close();
      try {
        await root.removeEntry(deps.name);
      } catch {
        // Nothing to remove.
      }
    },
  };
}
