/**
 * IndexedDB persistence for the meeting events of recordings, in a database of its own,
 * `zen-recorder-events`. Not a store in `zen-recorder`: that database would have to go to
 * version 2, and an older build opening it at version 1 after a downgrade gets `VersionError` and
 * records nothing at all. Each event is kept once, keyed by its recording and seq, so a batch sent
 * again stores nothing twice.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { MeetingEvent } from '@/lib/types';

interface StoredMeetingEvent {
  recordingId: string;
  seq: number;
  event: MeetingEvent;
  /** The background's `Date.now()` when it stored the event. */
  receivedAt: number;
}

export interface EventStore {
  /** Stores the events in one transaction; a seq stored before is replaced. */
  putBatch(recordingId: string, events: MeetingEvent[], receivedAt: number): Promise<void>;
  /** Ordered by seq. */
  getEvents(recordingId: string): Promise<StoredMeetingEvent[]>;
  countEvents(recordingId: string): Promise<number>;
  deleteEvents(recordingId: string): Promise<void>;
  listRecordingIds(): Promise<string[]>;
  close(): Promise<void>;
}

interface Schema extends DBSchema {
  events: { key: [string, number]; value: StoredMeetingEvent; indexes: { byRecording: string } };
}

/**
 * Version 1. A later version adds its steps under `oldVersion < n` in `upgrade`, so a database a
 * user already has is changed, never created again.
 */
const DB_VERSION = 1;

export function openEventStore(name = 'zen-recorder-events'): EventStore {
  let db: Promise<IDBPDatabase<Schema>> | null = null;
  const open = (): Promise<IDBPDatabase<Schema>> => {
    db ??= openDB<Schema>(name, DB_VERSION, {
      upgrade(database) {
        const events = database.createObjectStore('events', { keyPath: ['recordingId', 'seq'] });
        events.createIndex('byRecording', 'recordingId');
      },
    });
    return db;
  };

  return {
    async putBatch(recordingId, events, receivedAt) {
      const tx = (await open()).transaction('events', 'readwrite');
      await Promise.all([
        ...events.map((event) => tx.store.put({ recordingId, seq: event.seq, event, receivedAt })),
        tx.done,
      ]);
    },
    async getEvents(recordingId) {
      return (await open()).getAllFromIndex('events', 'byRecording', recordingId);
    },
    async countEvents(recordingId) {
      return (await open()).countFromIndex('events', 'byRecording', recordingId);
    },
    async deleteEvents(recordingId) {
      const tx = (await open()).transaction('events', 'readwrite');
      let cursor = await tx.store.index('byRecording').openKeyCursor(recordingId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async listRecordingIds() {
      const ids = await (await open()).getAllKeysFromIndex('events', 'byRecording');
      return [...new Set(ids.map(([recordingId]) => recordingId))];
    },
    async close() {
      if (db) (await db).close();
      db = null;
    },
  };
}
