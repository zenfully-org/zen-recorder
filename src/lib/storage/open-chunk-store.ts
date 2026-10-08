/**
 * IndexedDB persistence for recordings (metadata) and their chunks (Blobs). In Firefox, Blobs in
 * IndexedDB are file-backed, so assembling a multi-hour recording never copies bytes into JS heap.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { RecordingMeta } from '@/lib/types';

export interface StoredChunk {
  recordingId: string;
  seq: number;
  blob: Blob;
  byteLength: number;
  receivedAt: number;
}

export interface ChunkStore {
  putRecording(meta: RecordingMeta): Promise<void>;
  getRecording(id: string): Promise<RecordingMeta | undefined>;
  updateRecording(id: string, patch: Partial<RecordingMeta>): Promise<RecordingMeta | undefined>;
  /** Newest first. */
  listRecordings(): Promise<RecordingMeta[]>;
  deleteRecording(id: string): Promise<void>;
  putChunk(chunk: StoredChunk): Promise<void>;
  /** Ordered by sequence number. */
  getChunks(recordingId: string): Promise<StoredChunk[]>;
  countChunks(recordingId: string): Promise<number>;
  /** The recordings that have chunks stored, whether their metadata is stored or not. */
  listRecordingIdsWithChunks(): Promise<string[]>;
  deleteChunks(recordingId: string): Promise<void>;
  close(): Promise<void>;
}

interface Schema extends DBSchema {
  recordings: { key: string; value: RecordingMeta; indexes: { byStartedAt: number } };
  chunks: { key: [string, number]; value: StoredChunk; indexes: { byRecording: string } };
}

const DB_VERSION = 1;

export function openChunkStore(name = 'zen-recorder'): ChunkStore {
  let db: Promise<IDBPDatabase<Schema>> | null = null;
  const open = (): Promise<IDBPDatabase<Schema>> => {
    db ??= openDB<Schema>(name, DB_VERSION, {
      upgrade(database) {
        const recordings = database.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('byStartedAt', 'startedAt');
        const chunks = database.createObjectStore('chunks', { keyPath: ['recordingId', 'seq'] });
        chunks.createIndex('byRecording', 'recordingId');
      },
    });
    return db;
  };

  const deleteChunks = async (recordingId: string): Promise<void> => {
    const tx = (await open()).transaction('chunks', 'readwrite');
    let cursor = await tx.store.index('byRecording').openKeyCursor(recordingId);
    while (cursor) {
      await tx.store.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  };

  return {
    async putRecording(meta) {
      await (await open()).put('recordings', meta);
    },
    async getRecording(id) {
      return (await open()).get('recordings', id);
    },
    async updateRecording(id, patch) {
      const tx = (await open()).transaction('recordings', 'readwrite');
      const current = await tx.store.get(id);
      if (!current) {
        await tx.done;
        return undefined;
      }
      const next = { ...current, ...patch };
      await tx.store.put(next);
      await tx.done;
      return next;
    },
    async listRecordings() {
      return (await (await open()).getAllFromIndex('recordings', 'byStartedAt')).reverse();
    },
    async deleteRecording(id) {
      await deleteChunks(id);
      await (await open()).delete('recordings', id);
    },
    async putChunk(chunk) {
      await (await open()).put('chunks', chunk);
    },
    async getChunks(recordingId) {
      const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
      return (await open()).getAll('chunks', range);
    },
    async countChunks(recordingId) {
      return (await open()).countFromIndex('chunks', 'byRecording', recordingId);
    },
    async listRecordingIdsWithChunks() {
      const index = (await open()).transaction('chunks').store.index('byRecording');
      const ids: string[] = [];
      for (
        let cursor = await index.openKeyCursor(null, 'nextunique');
        cursor;
        cursor = await cursor.continue()
      ) {
        ids.push(cursor.key);
      }
      return ids;
    },
    deleteChunks,
    async close() {
      if (!db) return;
      (await db).close();
      db = null;
    },
  };
}
