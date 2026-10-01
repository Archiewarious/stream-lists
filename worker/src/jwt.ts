// Twitch extension JWT: HS256, the key is the extension secret (base64-encoded in the Twitch console).

export interface TwitchJwtPayload {
  exp: number;
  channel_id: string;
  role: 'broadcaster' | 'moderator' | 'viewer' | 'external';
  opaque_user_id?: string;
  user_id?: string;
}

const encoder = new TextEncoder();

const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const base64UrlToBytes = (base64Url: string) => base64ToBytes(base64Url.replace(/-/g, '+').replace(/_/g, '/'));
const base64UrlToText = (base64Url: string) => new TextDecoder().decode(base64UrlToBytes(base64Url));
const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textToBase64Url = (text: string) => bytesToBase64Url(encoder.encode(text));

const importKey = (secret: string) =>
  crypto.subtle.importKey('raw', base64ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Returns the payload of a valid, unexpired token, otherwise null. */
export const verifyJwt = async (token: string, secret: string, now = Date.now()): Promise<TwitchJwtPayload | null> => {
  const [header, payload, signature, ...rest] = token.split('.');
  if (!header || !payload || !signature || rest.length) return null;

  try {
    if (JSON.parse(base64UrlToText(header)).alg !== 'HS256') return null;

    const isSigned = await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      base64UrlToBytes(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!isSigned) return null;

    const claims = JSON.parse(base64UrlToText(payload));
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    if (typeof claims.channel_id !== 'string' || typeof claims.role !== 'string') return null;
    return claims;
  } catch {
    return null; // malformed base64 or JSON
  }
};

export const signJwt = async (payload: object, secret: string) => {
  const body = `${textToBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${textToBase64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
};
