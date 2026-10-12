import { renderPopupOverCall } from './render-popup-over-call';

const CALL = 'data:image/png;base64,Y2FsbA==';
const POPUP = 'data:image/png;base64,cG9wdXA=';

function render(): Document {
  const html = renderPopupOverCall({ call: CALL, popup: { src: POPUP, width: 540, height: 683 } });
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('renderPopupOverCall', () => {
  it('shows the call as the page, the full 1280 by 800', () => {
    const call = render().querySelector('img.call');

    expect(call?.getAttribute('src')).toBe(CALL);
    expect([call?.getAttribute('width'), call?.getAttribute('height')]).toEqual(['1280', '800']);
  });

  it('opens the popup at its size under the toolbar, at the top right', () => {
    const popup = render().querySelector('img.popup');

    expect(popup?.getAttribute('src')).toBe(POPUP);
    expect([popup?.getAttribute('width'), popup?.getAttribute('height')]).toEqual(['540', '683']);
    const style = render().querySelector('style')?.textContent ?? '';
    expect(style).toMatch(/\.popup \{[^}]*top: 12px;[^}]*right: 24px;/);
  });
});
