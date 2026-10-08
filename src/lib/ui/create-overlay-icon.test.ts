import { describe, expect, it } from 'vitest';
import { createOverlayIcon } from './create-overlay-icon';

describe('createOverlayIcon', () => {
  it.each([
    ['record', 'circle'],
    ['pause', 'path'],
    ['resume', 'path'],
    ['stop', 'rect'],
    ['chevron', 'path'],
  ] as const)('draws %s as an inline SVG %s that screen readers skip', (name, shape) => {
    const icon = createOverlayIcon(document, name);
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(icon.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('focusable')).toBe('false');
    expect(icon.getAttribute('class')).toBe(`zr-icon zr-icon-${name}`);
    expect(icon.children).toHaveLength(1);
    expect(icon.firstElementChild?.localName).toBe(shape);
    expect(icon.textContent).toBe('');
  });

  it('strokes the chevron and fills the rest', () => {
    expect(createOverlayIcon(document, 'chevron').firstElementChild?.getAttribute('fill')).toBe(
      'none',
    );
    expect(createOverlayIcon(document, 'stop').firstElementChild?.getAttribute('fill')).toBe(
      'currentColor',
    );
  });
});
