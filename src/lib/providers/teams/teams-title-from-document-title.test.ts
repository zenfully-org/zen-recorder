import { describe, expect, it } from 'vitest';
import { teamsTitleFromDocumentTitle } from './teams-title-from-document-title';

describe('teamsTitleFromDocumentTitle', () => {
  it.each([
    ['Weekly sync | Microsoft Teams', 'Weekly sync'],
    ['Weekly sync', 'Weekly sync'],
    ['  Planning | Q4   |  Microsoft Teams ', 'Planning | Q4'],
  ])('cleans "%s"', (title, expected) => {
    expect(teamsTitleFromDocumentTitle(title)).toBe(expected);
  });

  it.each([[''], ['Microsoft Teams'], [' | Microsoft Teams']])(
    'falls back to a generic title for "%s"',
    (title) => {
      expect(teamsTitleFromDocumentTitle(title)).toBe('Microsoft Teams meeting');
    },
  );
});
