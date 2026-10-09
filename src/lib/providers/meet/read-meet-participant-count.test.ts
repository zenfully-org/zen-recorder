import { beforeEach, describe, expect, it } from 'vitest';
import { readMeetParticipantCount } from './read-meet-participant-count';

/** Meet's people count badge, as the in-call page carries it. */
function showBadge(count: string | null, text = count ?? ''): HTMLElement {
  const badge = document.createElement('span');
  if (count !== null) badge.setAttribute('data-avatar-count', count);
  badge.textContent = text;
  document.body.append(badge);
  return badge;
}

describe('readMeetParticipantCount', () => {
  beforeEach(() => document.body.replaceChildren());

  it.each([
    ['1', 1],
    ['2', 2],
    [' 12 ', 12],
    ['150', 150],
  ])('reads the people count "%s", the user included', (count, expected) => {
    showBadge(count);
    expect(readMeetParticipantCount(document)).toBe(expected);
  });

  it.each([['0'], [''], ['two'], ['-1'], ['1.5'], ['9+']])(
    'cannot tell from the count %j',
    (count) => {
      showBadge(count);
      expect(readMeetParticipantCount(document)).toBeNull();
    },
  );

  it('cannot tell without the badge', () => {
    showBadge(null, '3');
    expect(readMeetParticipantCount(document)).toBeNull();
  });

  it('reads the attribute, not the text the badge shows', () => {
    showBadge('4', '3');
    expect(readMeetParticipantCount(document)).toBe(4);
  });
});
