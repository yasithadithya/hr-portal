import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, parseMasterKey } from './secrets';

const key = randomBytes(32);

describe('tenant secret encryption', () => {
  it('round-trips and never repeats ciphertext', () => {
    const a = encryptSecret('postgres://u:p@h/db', key);
    const b = encryptSecret('postgres://u:p@h/db', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('postgres');
    expect(decryptSecret(a, key)).toBe('postgres://u:p@h/db');
  });

  it('rejects tampering and the wrong key', () => {
    const enc = encryptSecret('secret', key);
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it('validates the master key', () => {
    expect(() => parseMasterKey(undefined)).toThrow(/not set/);
    expect(() => parseMasterKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseMasterKey(key.toString('base64'))).toHaveLength(32);
  });
});
