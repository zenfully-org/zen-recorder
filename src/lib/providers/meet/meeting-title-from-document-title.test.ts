import { describe, expect, it } from 'vitest';
import { meetingTitleFromDocumentTitle } from './meeting-title-from-document-title';

describe('meetingTitleFromDocumentTitle', () => {
  it.each([
    ['Design review - Google Meet', 'abc-defg-hij', 'Design review'],
    ['Design review – Google Meet', 'abc-defg-hij', 'Design review'],
    ['Design review — google meet', 'abc-defg-hij', 'Design review'],
    ['Meet – Google Meet', 'abc-defg-hij', 'abc-defg-hij'],
    ['', 'abc-defg-hij', 'abc-defg-hij'],
    ['', null, 'meeting'],
    ['Google Meet', null, 'Google Meet'],
    ['  Standup  ', null, 'Standup'],
  ])('%j with code %j → %j', (title, code, expected) => {
    expect(meetingTitleFromDocumentTitle(title, code)).toBe(expected);
  });
});
