import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for tenant secrets (PLAN.md §1 Secrets). Format: `v1.<iv>.<tag>.<ciphertext>`
 * (base64url). The key comes from MASTER_KEY in env and is never stored in the database.
 */

const VERSION = 'v1';

export function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)');
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new Error('Unrecognised secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}
