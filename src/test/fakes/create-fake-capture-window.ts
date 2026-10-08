/**
 * A window double for capture hooks and providers: a fake `RTCPeerConnection` constructor that
 * records what the "page" creates, and a `getUserMedia` that hands out a fake microphone track.
 * Timers are the real (or vitest-faked) ones.
 */
import {
  createFakeMediaStreamTrack,
  type FakeMediaStreamTrack,
} from '@/test/fakes/create-fake-media-stream-track';
import {
  createFakeRtcPeerConnection,
  type FakeRtcPeerConnection,
} from '@/test/fakes/create-fake-rtc-peer-connection';

export interface FakeCaptureWindow {
  win: Window & typeof globalThis;
  /** Every peer connection the page created through `new win.RTCPeerConnection()`. */
  connections: FakeRtcPeerConnection[];
  micTrack: FakeMediaStreamTrack;
  /** Acts like the page: opens a peer connection. */
  openConnection(): FakeRtcPeerConnection;
  /** Acts like the page: asks for the microphone. */
  requestMic(): Promise<MediaStream>;
}

export function createFakeCaptureWindow(): FakeCaptureWindow {
  const connections: FakeRtcPeerConnection[] = [];
  const micTrack = createFakeMediaStreamTrack({ label: 'Fake Microphone' });
  function FakePeerConnection() {
    const pc = createFakeRtcPeerConnection();
    connections.push(pc);
    return pc;
  }
  const mediaDevices = { getUserMedia: async () => new MediaStream([micTrack]) };
  // Built from `any` on purpose: a double only has the members the code under test touches.
  const win: Window & typeof globalThis = Object.assign(Object.create(null), {
    RTCPeerConnection: FakePeerConnection,
    navigator: { mediaDevices },
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (id: number) => clearInterval(id),
  });
  return {
    win,
    connections,
    micTrack,
    openConnection() {
      Reflect.construct(win.RTCPeerConnection, []);
      const created = connections.at(-1);
      if (!created) throw new Error('the fake constructor did not run');
      return created;
    },
    requestMic: () => win.navigator.mediaDevices.getUserMedia({ audio: true }),
  };
}
