/** Stateless root sessions signed server-side; rotation of ADMIN_PASSWORD revokes them. */
const sessionLifetimeMs = 24 * 60 * 60 * 1000;

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function signatureToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function issueRootSession(secret: string): Promise<{ token: string; expiresAt: string }> {
  if (!secret) throw new Error('A senha administrativa não está configurada no servidor.');
  const expires = Date.now() + sessionLifetimeMs;
  const nonce = crypto.randomUUID();
  const payload = `v1.${expires}.${nonce}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(`gbtvon:root:${payload}`));
  return { token: `${payload}.${signatureToHex(signature)}`, expiresAt: new Date(expires).toISOString() };
}
export async function verifyRootSession(token: unknown, secret: string): Promise<boolean> {
  if (typeof token !== 'string' || !secret || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires <= Date.now() || expires > Date.now() + sessionLifetimeMs + 60000) return false;
  const signature = Uint8Array.from(parts[3].match(/.{2}/g) ?? [], value => parseInt(value, 16));
  return crypto.subtle.verify('HMAC', await signingKey(secret), signature, new TextEncoder().encode(`gbtvon:root:${parts.slice(0, 3).join('.')}`));
}
