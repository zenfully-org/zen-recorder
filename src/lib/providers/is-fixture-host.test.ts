import { describe, expect, it } from 'vitest';
import { isFixtureHost } from './is-fixture-host';

describe('isFixtureHost', () => {
  it.each(['localhost', '127.0.0.1'])('recognises %s', (hostname) => {
    expect(isFixtureHost(hostname)).toBe(true);
  });

  it.each(['meet.google.com', 'localhost.example.com', 'app.zoom.us', ''])(
    'rejects %s',
    (hostname) => {
      expect(isFixtureHost(hostname)).toBe(false);
    },
  );
});
