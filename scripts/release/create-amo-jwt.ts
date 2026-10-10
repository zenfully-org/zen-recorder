import { createHmac } from 'node:crypto';

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * The JSON Web Token one request to addons.mozilla.org's API carries (`Authorization: JWT <token>`):
 * HS256 with the API secret, the API key as its issuer, a one-off id, valid for a minute.
 */
export function createAmoJwt({
  issuer,
  secret,
  nowSeconds,
  id,
}: {
  issuer: string;
  secret: string;
  nowSeconds: number;
  id: string;
}): string {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, jti: id, iat: nowSeconds, exp: nowSeconds + 60 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
