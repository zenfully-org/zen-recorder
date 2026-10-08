import { describe, expect, it } from 'vitest';
import { readDomHints } from './read-dom-hints';

function dom(html: string): Document {
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = html;
  return doc;
}

const TILE =
  '<div data-participant-id="spaces/x/devices/1" data-tile-media-id="m1"><video></video></div>';

describe('readDomHints', () => {
  it.each([
    ['nothing', '', { inCallUi: false, admitted: false }],
    ['a tile without call controls (pre-join preview)', TILE, { inCallUi: false, admitted: false }],
    [
      'the knocking lobby (leave + chat controls, no tiles)',
      '<i class="google-symbols">call_end</i><i class="google-symbols">chat</i>',
      { inCallUi: true, admitted: false },
    ],
    [
      'an admitted call (call controls + a participant tile)',
      `<i class="google-symbols"> call_end </i>${TILE}`,
      { inCallUi: true, admitted: true },
    ],
    [
      'other symbol classes',
      `<i class="material-symbols-outlined">call_end</i>${TILE}`,
      { inCallUi: true, admitted: true },
    ],
    [
      'a tile missing the media slot (people panel row)',
      '<i class="google-symbols">call_end</i><div data-participant-id="p"></div>',
      { inCallUi: true, admitted: false },
    ],
    ['empty icon elements', '<i class="google-symbols"></i>', { inCallUi: false, admitted: false }],
  ])('%s', (_label, html, expected) => {
    expect(readDomHints(dom(html))).toEqual(expected);
  });
});
