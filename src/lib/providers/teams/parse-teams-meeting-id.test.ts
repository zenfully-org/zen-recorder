import { describe, expect, it } from 'vitest';
import { parseTeamsMeetingId } from './parse-teams-meeting-id';

const THREAD = '19:meeting_MDAwMDAwMDAtZmFrZS1mYWtl@thread.v2';
const at = (
  location: Partial<{ hostname: string; pathname: string; search: string; hash: string }>,
) =>
  parseTeamsMeetingId({
    hostname: 'teams.microsoft.com',
    pathname: '/',
    search: '',
    hash: '',
    ...location,
  });
const coords = (value: unknown) =>
  `?anon=true&coords=${encodeURIComponent(btoa(JSON.stringify(value)))}`;

describe('parseTeamsMeetingId', () => {
  it.each([
    [
      'the join link',
      { pathname: `/l/meetup-join/${encodeURIComponent(THREAD)}/0`, search: '?context=%7b%7d' },
    ],
    ['the join link, not encoded', { pathname: `/l/meetup-join/${THREAD}/0` }],
    [
      'the launcher hop',
      {
        pathname: '/dl/launcher/launcher.html',
        search: `?url=${encodeURIComponent(`/_#/l/meetup-join/${THREAD}/0?context=x`)}&type=meetup-join`,
      },
    ],
    [
      'the /v2/ hop (hash route)',
      {
        pathname: '/v2/',
        search: '?meetingjoin=true',
        hash: `#/l/meetup-join/${THREAD}/0?context=%7b%7d`,
      },
    ],
    [
      'the light meeting page (coords)',
      {
        pathname: '/light-meetings/launch',
        search: coords({ conversationId: THREAD, tenantId: 't', messageId: '0' }),
      },
    ],
  ])('reads the meeting thread from %s', (_name, location) => {
    expect(at(location)).toBe('meeting_MDAwMDAwMDAtZmFrZS1mYWtl');
  });

  it.each([
    [
      'a personal meeting link',
      { hostname: 'teams.live.com', pathname: '/meet/9312345678901', search: '?p=abc' },
      '9312345678901',
    ],
    ['a short work meeting link', { pathname: '/meet/2912345678901' }, '2912345678901'],
    ['a short link behind /v2/', { pathname: '/v2/meet/2912345678901/' }, '2912345678901'],
  ])('reads the meeting number from %s', (_name, location, expected) => {
    expect(at(location)).toBe(expected);
  });

  it('accepts url-safe base64 without padding, and a "+" left unescaped, in coords', () => {
    const raw = btoa(JSON.stringify({ conversationId: '19:meeting_a>>b??c@thread.v2' }));
    expect(raw).toContain('+');
    expect(raw).toContain('/');
    const urlSafe = raw.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(at({ search: `?coords=${urlSafe}` })).toBe('meeting_a>>b??c');
    expect(at({ search: `?coords=${raw}` })).toBe('meeting_a>>b??c');
  });

  it.each([
    ['the app home', { pathname: '/v2/' }],
    ['a chat route', { pathname: '/v2/', hash: '#/conversations/19:abc@thread.v2?ctx=chat' }],
    ['coords that are not base64', { search: '?coords=%%%' }],
    ['coords that are not JSON', { search: `?coords=${btoa('not json')}` }],
    ['coords without a conversation', { search: coords({ tenantId: 't' }) }],
    [
      'coords with a conversation that is not a thread',
      { search: coords({ conversationId: 'abc' }) },
    ],
    ['a broken percent escape', { pathname: '/l/meetup-join/%E0%A4%A/0' }],
    ['an empty meeting number', { pathname: '/meet/' }],
  ])('returns null for %s', (_name, location) => {
    expect(at(location)).toBeNull();
  });
});
