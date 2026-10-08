/**
 * Origin-private file system double: directory + file handles whose writable streams accept the
 * positioned `{ type: 'write', data, position }` chunks Mediabunny's StreamTarget emits.
 */

export interface FakeOpfsStorage {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
  files: Map<string, Uint8Array<ArrayBuffer>>;
  removed: string[];
  /** Make `writable.close()` reject (as it does once the muxer already closed it). */
  failClose: boolean;
}

export function createFakeOpfsStorage(): FakeOpfsStorage {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const removed: string[] = [];
  const storage: FakeOpfsStorage = {
    files,
    removed,
    failClose: false,
    async getDirectory() {
      const directory = {
        async getFileHandle(name: string, options?: { create?: boolean }) {
          if (!files.has(name)) {
            if (!options?.create) throw new DOMException('not found', 'NotFoundError');
            files.set(name, new Uint8Array(0));
          }
          return {
            async createWritable(options?: { keepExistingData?: boolean }) {
              if (!options?.keepExistingData) files.set(name, new Uint8Array(0));
              let position = 0;
              const stream = new WritableStream<
                { type: 'write'; data: Uint8Array; position?: number } | Uint8Array
              >({
                write(chunk) {
                  const data = chunk instanceof Uint8Array ? chunk : chunk.data;
                  if (!(chunk instanceof Uint8Array) && chunk.position !== undefined) {
                    position = chunk.position;
                  }
                  const current = files.get(name) ?? new Uint8Array(0);
                  const end = position + data.length;
                  const next = end > current.length ? new Uint8Array(end) : current;
                  if (next !== current) next.set(current);
                  next.set(data, position);
                  files.set(name, next);
                  position = end;
                },
                close() {
                  if (storage.failClose) throw new TypeError('already closed');
                },
              });
              return stream as unknown as FileSystemWritableFileStream;
            },
            async getFile() {
              return new File([files.get(name) ?? new Uint8Array(0)], name);
            },
          } as unknown as FileSystemFileHandle;
        },
        async removeEntry(name: string) {
          if (!files.has(name)) throw new DOMException('not found', 'NotFoundError');
          files.delete(name);
          removed.push(name);
        },
      };
      return directory as unknown as FileSystemDirectoryHandle;
    },
  };
  return storage;
}
