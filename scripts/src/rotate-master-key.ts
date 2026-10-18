import { decryptSecret, encryptSecret, parseMasterKey, schema } from '@hr/control-db';

import { log, main, openControl, requireEnv } from './lib';

/**
 * pnpm secrets:rotate-master-key [--dry-run]
 *
 * Re-encrypts every tenant secret (DB URLs, service-role keys, VAPID private keys) from
 * MASTER_KEY to NEW_MASTER_KEY in ONE transaction: either every row moves or none does.
 * Both keys come from env only. Procedure: docs/operations.md → "Rotate the master key".
 */
const ENCRYPTED = [
  'dbUrlEnc',
  'dbDirectUrlEnc',
  'serviceRoleKeyEnc',
  'vapidPrivateKeyEnc',
] as const;

await main(async () => {
  const oldKey = parseMasterKey(requireEnv('MASTER_KEY'));
  const newKey = parseMasterKey(requireEnv('NEW_MASTER_KEY'));
  if (oldKey.equals(newKey)) throw new Error('NEW_MASTER_KEY is the same as MASTER_KEY');
  const dryRun = process.argv.includes('--dry-run');
  const { sql, db } = openControl({ direct: true });
  try {
    const rows = await db.select().from(schema.tenantSecrets);
    // Decrypt everything first: a wrong MASTER_KEY fails here, before anything is written.
    const plans = rows.map((r) => {
      const set: Partial<Record<(typeof ENCRYPTED)[number], string>> = {};
      for (const col of ENCRYPTED) {
        const v = r[col];
        if (v) set[col] = encryptSecret(decryptSecret(v, oldKey), newKey);
      }
      return { tenantId: r.tenantId, set };
    });
    // Prove the new ciphertexts decrypt with the new key before committing.
    for (const p of plans) for (const v of Object.values(p.set)) decryptSecret(v!, newKey);
    log(
      `${plans.length} tenant(s), ${plans.reduce((a, p) => a + Object.keys(p.set).length, 0)} secret(s) to re-encrypt`,
    );
    if (dryRun) {
      log('Dry run: nothing written.');
      return;
    }
    const column: Record<(typeof ENCRYPTED)[number], string> = {
      dbUrlEnc: 'db_url_enc',
      dbDirectUrlEnc: 'db_direct_url_enc',
      serviceRoleKeyEnc: 'service_role_key_enc',
      vapidPrivateKeyEnc: 'vapid_private_key_enc',
    };
    await sql.begin(async (tx) => {
      for (const p of plans) {
        const set = Object.fromEntries(
          Object.entries(p.set).map(([k, v]) => [column[k as (typeof ENCRYPTED)[number]], v]),
        );
        if (!Object.keys(set).length) continue;
        await tx`update platform.tenant_secrets set ${tx(set)}, rotated_at = now() where tenant_id = ${p.tenantId}`;
      }
    });
    log('✔ Re-encrypted. Now set MASTER_KEY to the new value everywhere and restart the API.');
  } finally {
    await sql.end();
  }
});
