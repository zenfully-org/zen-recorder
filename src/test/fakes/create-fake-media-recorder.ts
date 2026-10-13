/**
 * MediaRecorder double. Returns a constructor (browser API shape) plus a registry of instances so
 * tests can emit chunks and errors. A class is used here only because the real API is a class; it
 * has every member of `MediaRecorder`, so it is one as far as the code under test can tell.
 */

interface FakeMediaRecorderInstance extends EventTarget {
  stream: MediaStream;
  options: MediaRecorderOptions | undefined;
  mimeType: string;
  state: RecordingState;
  timeslice: number | undefined;
  requestDataCalls: number;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  requestData(): void;
  emitData(bytes: number): void;
  emitError(error?: unknown): void;
}

export interface FakeMediaRecorderFactory {
  Ctor: typeof MediaRecorder;
  instances: FakeMediaRecorderInstance[];
  /** The next `count` calls to `start()` throw, as a recorder that cannot start does. */
  failStarts(count: number): void;
}

export function createFakeMediaRecorder(
  options: { supported?: string[]; reportedMimeType?: string; throwOnStart?: boolean } = {},
): FakeMediaRecorderFactory {
  const supported = options.supported ?? ['audio/webm;codecs=opus'];
  const instances: FakeMediaRecorderInstance[] = [];
  let failingStarts = 0;

  class FakeMediaRecorder extends EventTarget implements MediaRecorder, FakeMediaRecorderInstance {
    static isTypeSupported(type: string): boolean {
      return supported.includes(type);
    }
    stream: MediaStream;
    options: MediaRecorderOptions | undefined;
    mimeType: string;
    state: RecordingState = 'inactive';
    timeslice: number | undefined;
    requestDataCalls = 0;
    audioBitsPerSecond = 0;
    videoBitsPerSecond = 0;
    ondataavailable = null;
    onerror = null;
    onpause = null;
    onresume = null;
    onstart = null;
    onstop = null;
    constructor(stream: MediaStream, recorderOptions?: MediaRecorderOptions) {
      super();
      this.stream = stream;
      this.options = recorderOptions;
      this.mimeType = options.reportedMimeType ?? recorderOptions?.mimeType ?? '';
      instances.push(this);
    }
    start(timeslice?: number): void {
      if (failingStarts > 0) {
        failingStarts--;
        throw new Error('cannot start');
      }
      if (options.throwOnStart) throw new Error('cannot start');
      this.state = 'recording';
      this.timeslice = timeslice;
    }
    stop(): void {
      this.state = 'inactive';
      this.emitData(0);
      this.dispatchEvent(new Event('stop'));
    }
    pause(): void {
      this.state = 'paused';
    }
    resume(): void {
      this.state = 'recording';
    }
    requestData(): void {
      this.requestDataCalls++;
    }
    emitData(bytes: number): void {
      const data = new Blob([new Uint8Array(bytes)]);
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
    }
    emitError(error?: unknown): void {
      const event = new Event('error');
      this.dispatchEvent(error === undefined ? event : Object.assign(event, { error }));
    }
  }

  return {
    Ctor: FakeMediaRecorder,
    instances,
    failStarts: (count) => {
      failingStarts = count;
    },
  };
}
