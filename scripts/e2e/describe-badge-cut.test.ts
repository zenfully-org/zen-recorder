// @vitest-environment node
import { describeBadgeCut } from './describe-badge-cut';

describe('describeBadgeCut', () => {
  it.each([
    ['fills the badge', { text: '!', scrollWidth: 14, clientWidth: 14 }],
    ['is narrower than the badge', { text: '●', scrollWidth: 12, clientWidth: 14 }],
    ['is empty', { text: '', scrollWidth: 0, clientWidth: 0 }],
  ])('says nothing when the text %s', (_label, drawn) => {
    expect(describeBadgeCut(drawn)).toBeNull();
  });

  it('says how wide a text is that Firefox cuts, against the badge', () => {
    expect(describeBadgeCut({ text: 'REC', scrollWidth: 24, clientWidth: 20 })).toBe(
      `Firefox cuts the badge's "REC": it needs 24 px, and the badge is 20 px wide`,
    );
  });
});
