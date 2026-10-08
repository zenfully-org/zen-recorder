/**
 * Minimal OffscreenCanvas double: Mediabunny draws a canvas into an OffscreenCanvas when WebCodecs'
 * VideoFrame is unavailable (as under Vitest). No pixels are produced; the fake encoders never look.
 */

export function createFakeOffscreenCanvas(): typeof OffscreenCanvas {
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): { drawImage(): void } {
      return { drawImage: () => undefined };
    }
  }
  return FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}
