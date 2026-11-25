import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { rotateAccountKeys } from '../src/hosted/rotate-key.js';

async function privateKey(file: string): Promise<Buffer> {
 if (!path.isAbsolute(file)) throw Error('Key files must use absolute paths.');
 const info = await stat(file);
 if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('Key files must be private regular files (0600).');
 const value = (await readFile(file,'utf8')).trim();
 if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Error('Each key file must contain one 32-byte base64 key.');
 const key = Buffer.from(value,'base64');
 if (key.length !== 32 || key.toString('base64') !== value) throw Error('Invalid key encoding.');
 return key;
}
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--offline-no-external-envelopes' || args[1] !== '--keys' || !args[2] || !args[3]) {
 console.error('Read docs/KEY-ROTATION.md first. Usage: node dist/scripts/rotate-account-key.js --offline-no-external-envelopes --keys /private/old.key /private/new.key');
 process.exit(2);
}
const oldKey = await privateKey(args[2]), newKey = await privateKey(args[3]);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PG_SSL === 'true' ? {rejectUnauthorized:true} : undefined });
try {
 const count = await rotateAccountKeys(pool,oldKey,newKey);
 console.log(`Re-encrypted ${count} account profiles. Keep the app stopped until the new key is configured. See docs/KEY-ROTATION.md.`);
} catch {
 console.error('Rotation did not complete cleanly. Keep the app stopped: transaction outcome may be uncertain after a connection failure. Consult the recovery instructions.');
 process.exitCode = 1;
} finally { await pool.end(); oldKey.fill(0); newKey.fill(0); }
