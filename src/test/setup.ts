// Vitest setup: happy-dom lacks MediaStream and IndexedDB, and its Blob is not structured-cloneable
// (fake-indexeddb would store it as a plain object). Provide stand-ins that behave like Firefox.
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

class FakeMediaStream {
  readonly id = Math.random().toString(36).slice(2);
  readonly #tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.#tracks = [...tracks];
  }
  getTracks(): MediaStreamTrack[] {
    return [...this.#tracks];
  }
  getAudioTracks(): MediaStreamTrack[] {
    return this.#tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.#tracks.filter((t) => t.kind === 'video');
  }
}

vi.stubGlobal('MediaStream', FakeMediaStream);
vi.stubGlobal('Blob', NodeBlob);
vi.stubGlobal('File', NodeFile);
