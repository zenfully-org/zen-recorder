// @vitest-environment node
/**
 * addons.mozilla.org's API authenticates each request with a JSON Web Token signed with the API
 * secret (HS256), naming the key as its issuer, with a one-off id and a lifetime of at most five
 * minutes (addons-server, "Authentication (External)").
 */
import { createHmac } from 'node:crypto';
import { createAmoJwt } from './create-amo-jwt';

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('createAmoJwt', () => {
  const token = createAmoJwt({ issuer: 'user:1:2', secret: 's3cret', nowSeconds: 1000, id: 'abc' });
  const [header = '', payload = '', signature = ''] = token.split('.');

  it('is an HS256 JSON Web Token', () => {
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('names the key, a one-off id and a one-minute lifetime', () => {
    expect(decode(payload)).toEqual({ iss: 'user:1:2', jti: 'abc', iat: 1000, exp: 1060 });
  });

  it('is signed with the secret', () => {
    expect(signature).toBe(
      createHmac('sha256', 's3cret').update(`${header}.${payload}`).digest('base64url'),
    );
  });
});
