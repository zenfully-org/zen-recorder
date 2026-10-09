import { describe, expect, it } from 'vitest';
import { audioTapWorklet } from './audio-tap-worklet';

describe('audioTapWorklet', () => {
  it('registers its processor under the name the tap creates its node with', () => {
    const { processorName, source } = audioTapWorklet();
    expect(processorName).toBe('zen-recorder-tap');
    expect(source).toContain(`registerProcessor('${processorName}'`);
  });

  it('names its file after its source, so a changed module never takes an old file name', () => {
    const { file, source } = audioTapWorklet();
    expect(file).toMatch(/^audio-tap-worklet-[0-9a-f]{8}\.js$/);
    // FNV-1a over the source's UTF-16 code units, as the build writes it.
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index++) {
      hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193) >>> 0;
    }
    expect(file).toBe(`audio-tap-worklet-${hash.toString(16).padStart(8, '0')}.js`);
    expect(audioTapWorklet()).toEqual(audioTapWorklet());
  });
});
