export type OverlayIconName = 'record' | 'pause' | 'resume' | 'stop' | 'chevron';

const SVG = 'http://www.w3.org/2000/svg';

/** Each icon is one shape on a 16 × 16 grid, drawn in the button's text colour. */
const SHAPES: Record<OverlayIconName, { tag: string; attributes: Record<string, string> }> = {
  record: { tag: 'circle', attributes: { cx: '8', cy: '8', r: '4.5' } },
  pause: { tag: 'path', attributes: { d: 'M4 3h3v10H4zM9 3h3v10H9z' } },
  resume: { tag: 'path', attributes: { d: 'M5 2.75v10.5L13.25 8z' } },
  stop: { tag: 'rect', attributes: { x: '3.5', y: '3.5', width: '9', height: '9', rx: '1.5' } },
  chevron: {
    tag: 'path',
    attributes: {
      d: 'M4 10l4-4 4 4',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
};

/**
 * An inline SVG icon for the status card. Built element by element: the card lives on pages
 * whose Trusted Types policy refuses markup assigned as a string.
 */
export function createOverlayIcon(doc: Document, name: OverlayIconName): SVGSVGElement {
  const icon = doc.createElementNS(SVG, 'svg');
  icon.setAttribute('class', `zr-icon zr-icon-${name}`);
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const { tag, attributes } = SHAPES[name];
  const shape = doc.createElementNS(SVG, tag);
  for (const [attribute, value] of Object.entries({ fill: 'currentColor', ...attributes })) {
    shape.setAttribute(attribute, value);
  }
  icon.append(shape);
  return icon;
}
