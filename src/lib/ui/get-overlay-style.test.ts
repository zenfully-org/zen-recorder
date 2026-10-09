import { describe, expect, it } from 'vitest';
import { getOverlayStyle } from './get-overlay-style';

const css = getOverlayStyle();

/** The bodies (`{ … }`, nested braces included) of every rule that starts with `prelude`. */
function blocks(prelude: string): string[] {
  const found: string[] = [];
  let from = css.indexOf(prelude);
  while (from !== -1) {
    const open = css.indexOf('{', from);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    found.push(css.slice(open, end + 1));
    from = css.indexOf(prelude, end);
  }
  return found;
}

describe('getOverlayStyle', () => {
  it("resets what the meeting page's styles would pass into the shadow root", () => {
    expect(css).toContain(':host { all: initial; }');
  });

  it('keeps hidden elements hidden whatever their display rule says', () => {
    expect(css).toContain('[hidden] { display: none !important; }');
  });

  it('removes every animation and transition when the system asks for reduced motion', () => {
    const [reduced] = blocks('@media (prefers-reduced-motion: reduce)');
    expect(reduced).toContain('animation: none !important;');
    expect(reduced).toContain('transition: none !important;');
  });

  it('animates nothing but opacity and transforms, which the compositor runs off the main thread', () => {
    const transitioned = [...css.matchAll(/transition: ([^;]+);/g)].flatMap(([, list]) =>
      (list ?? '').split(',').map((part) => part.trim().split(' ')[0]),
    );
    expect(transitioned.length).toBeGreaterThan(0);
    expect(new Set(transitioned)).toEqual(new Set(['opacity', 'translate', 'none']));
    const keyframes = blocks('@keyframes');
    expect(keyframes.length).toBeGreaterThan(0);
    for (const body of keyframes) {
      const animated = [...body.matchAll(/([\w-]+):/g)].map(([, property]) => property);
      expect(animated.every((property) => ['opacity', 'transform'].includes(property ?? ''))).toBe(
        true,
      );
    }
  });

  it('gives the state where nothing records a glyph shape of its own, so colour is not the only cue', () => {
    const [shape] = blocks('.zr-card[data-tone="blocked"] .zr-glyph::after');
    expect(shape).toContain('border-radius: 1px;');
  });

  it('shows the few words of a lasting fault on the compact card only: the details say it in full', () => {
    expect(css).toContain('.zr-card[data-expanded="true"] .zr-alert');
    expect(blocks('.zr-alert {')[0]).toContain('color: var(--zr-amber);');
  });

  it('blurs nothing behind it, which would redraw with every video frame', () => {
    expect(css).not.toContain('backdrop-filter');
  });

  it("sizes in pixels: rem would follow the meeting page's root font size", () => {
    expect(css).not.toMatch(/\d(rem|em)\b/);
  });

  it('loads nothing from the network', () => {
    expect(css).not.toMatch(/url\(|@import/);
  });

  it('keeps borders in forced colours mode, where shadows disappear', () => {
    const [forced] = blocks('@media (forced-colors: active)');
    expect(forced).toContain('CanvasText');
  });
});
