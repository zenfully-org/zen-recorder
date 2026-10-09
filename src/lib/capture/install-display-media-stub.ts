/**
 * Test builds only: a screen to share where the browser has none. With its fake media
 * (`media.navigator.streams.fake`), Firefox answers `getDisplayMedia` with `NotFoundError`, from a
 * click or not (Firefox 155, 2026-10-09), so a fixture page could not share the user's screen.
 * The stub answers with a 640×360 picture the page draws and moves, and keeps Firefox's rule that
 * a share starts only from a click (transient user activation). It is installed before every
 * other hook, which then wraps it as it would wrap the browser's own.
 */

export interface DisplayMediaStubDeps {
  /** Where the page looks `getDisplayMedia` up: `navigator.mediaDevices`. */
  mediaDevices: { getDisplayMedia?: MediaDevices['getDisplayMedia'] };
  /** `navigator.userActivation`: whether the page is handling a click right now. */
  userActivation: { readonly isActive: boolean };
  createCanvas: () => HTMLCanvasElement;
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 10;

export function installDisplayMediaStub(deps: DisplayMediaStubDeps): void {
  const share = async (): Promise<MediaStream> => {
    if (!deps.userActivation.isActive) {
      throw new DOMException('getDisplayMedia requires a click', 'InvalidStateError');
    }
    const canvas = deps.createCanvas();
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new DOMException('cannot draw the shared screen', 'NotSupportedError');
    let frame = 0;
    const draw = () => {
      context.fillStyle = `hsl(${(frame * 12) % 360} 60% 40%)`;
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = '#ffffff';
      context.fillRect((frame * 16) % (WIDTH - 80), HEIGHT / 2 - 40, 80, 80);
      frame++;
    };
    draw();
    const stream = canvas.captureStream(FPS);
    const timer = deps.setInterval(() => {
      if (stream.getVideoTracks().every((track) => track.readyState === 'ended')) {
        deps.clearInterval(timer);
        return;
      }
      draw();
    }, 1000 / FPS);
    return stream;
  };
  Object.defineProperty(deps.mediaDevices, 'getDisplayMedia', {
    configurable: true,
    writable: true,
    value: share,
  });
}
