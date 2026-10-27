import { describe, expect, it } from 'vitest';
import { meetingTitleFromDocumentTitle } from './meeting-title-from-document-title';

describe('meetingTitleFromDocumentTitle', () => {
  it.each([
    ['Design review - Google Meet', 'abc-defg-hij', 'Design review'],
    ['Design review – Google Meet', 'abc-defg-hij', 'Design review'],
    ['Design review — google meet', 'abc-defg-hij', 'Design review'],
    ['Meet – Google Meet', 'abc-defg-hij', 'abc-defg-hij'],
    // The tab's title at `meet.google.com/meet/<code>`, the same in every UI language.
    ['Meet: Design review', 'abc-defg-hij', 'Design review'],
    ['Meet:  Design review ', 'abc-defg-hij', 'Design review'],
    ['Meet: abc-defg-hij', 'abc-defg-hij', 'abc-defg-hij'],
    ['Meet:', 'abc-defg-hij', 'abc-defg-hij'],
    ['Meet: ', null, 'meeting'],
    ['Meet: Meet', 'abc-defg-hij', 'abc-defg-hij'],
    // A name of its own that starts like the new form keeps its prefix under the old one.
    ['Meet: Design review - Google Meet', 'abc-defg-hij', 'Meet: Design review'],
    ['Meeting: Design review', 'abc-defg-hij', 'Meeting: Design review'],
    ['', 'abc-defg-hij', 'abc-defg-hij'],
    ['', null, 'meeting'],
    ['Google Meet', null, 'Google Meet'],
    ['  Standup  ', null, 'Standup'],
  ])('%j with code %j → %j', (title, code, expected) => {
    expect(meetingTitleFromDocumentTitle(title, code)).toBe(expected);
  });
});
