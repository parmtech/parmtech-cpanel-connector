import type { Pool } from 'pg';
import { decryptSecret, encryptSecret } from './crypto.js';

/** Call only with every application/renewal process stopped and a verified backup.
 * Transactional for database rows only; external encrypted files are not included. */
export async function rotateAccountKeys(pool: Pool, oldKey: Buffer, newKey: Buffer): Promise<number> {
 if (oldKey.length !== 32 || newKey.length !== 32 || oldKey.equals(newKey)) throw Error('Provide two different 32-byte keys.');
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE cpanel_accounts IN ACCESS EXCLUSIVE MODE');
  const result = await client.query<{id:string; user_id:string; encrypted_credentials:string}>('SELECT id,user_id,encrypted_credentials FROM cpanel_accounts ORDER BY id');
  for (const row of result.rows) {
   const context = `account:${row.user_id}:${row.id}`;
   const plain = decryptSecret(row.encrypted_credentials,context,oldKey);
   const replacement = encryptSecret(plain,context,newKey);
   if (decryptSecret(replacement,context,newKey) !== plain) throw Error('Re-encryption verification failed.');
   await client.query('UPDATE cpanel_accounts SET encrypted_credentials=$1 WHERE id=$2 AND user_id=$3',[replacement,row.id,row.user_id]);
  }
  await client.query('COMMIT'); return result.rowCount ?? 0;
 } catch (error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
