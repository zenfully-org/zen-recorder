/**
 * Origin-private file system double: directory + file handles whose writable streams accept the
 * positioned `{ type: 'write', data, position }` chunks Mediabunny's StreamTarget emits.
 */
import type { StreamTargetChunk } from 'mediabunny';
import type { OpfsStorage } from '@/lib/finalize/create-opfs-scratch-file';

export interface FakeOpfsStorage extends OpfsStorage {
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
      return {
        async getFileHandle(name, options) {
          if (!files.has(name)) {
            if (!options.create) throw new DOMException('not found', 'NotFoundError');
            files.set(name, new Uint8Array(0));
          }
          return {
            async createWritable(writableOptions) {
              if (!writableOptions.keepExistingData) files.set(name, new Uint8Array(0));
              return new WritableStream<StreamTargetChunk>({
                write({ data, position }) {
                  const current = files.get(name) ?? new Uint8Array(0);
                  const end = position + data.length;
                  const next = end > current.length ? new Uint8Array(end) : current;
                  if (next !== current) next.set(current);
                  next.set(data, position);
                  files.set(name, next);
                },
                close() {
                  if (storage.failClose) throw new TypeError('already closed');
                },
              });
            },
            async getFile() {
              return new File([files.get(name) ?? new Uint8Array(0)], name);
            },
          };
        },
        async removeEntry(name) {
          if (!files.has(name)) throw new DOMException('not found', 'NotFoundError');
          files.delete(name);
          removed.push(name);
        },
      };
    },
  };
  return storage;
}
