import {readFile,mkdir,open,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(!args.includes('--input')||!args.includes('--output'))throw Error('Usage: node scripts/init-hosted-config.mjs --input PRIVATE_INPUT.json --output ABSOLUTE_PRIVATE_PATH/runtime.json');
const output=value('--output'),input=value('--input');
if(!output||!path.isAbsolute(output)||!input)throw Error('Use an absolute private output path.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const relative=path.relative(root,output);
if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Keep private runtime configuration outside the project.');
const config=JSON.parse(await readFile(input,'utf8'));
for(const key of ['PUBLIC_BASE_URL','SETUP_OWNER_EMAIL','PGHOST','PGDATABASE','PGUSER','PGPASSWORD','MAIL_FROM']){
 if(typeof config[key]!=='string'||!config[key]||/REPLACE_|example\.(com|test)/.test(config[key]))throw Error('Complete the real installation setting: '+key);
}
const base=new URL(config.PUBLIC_BASE_URL);
if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('PUBLIC_BASE_URL must be an HTTPS origin.');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.SETUP_OWNER_EMAIL))throw Error('Set a valid owner email.');
if(!config.MAIL_TRANSPORT&&!config.SMTP_HOST)throw Error('Configure sendmail or SMTP.');
config.CREDENTIAL_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
if(Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY,'base64').length!==32)throw Error('Encryption key must decode to32bytes.');
config.REGISTRATION_ALLOWED_EMAILS ??= config.SETUP_OWNER_EMAIL;
await mkdir(path.dirname(output),{recursive:true,mode:0o700});
if(process.platform!=='win32'&&((await stat(path.dirname(output))).mode&0o077))throw Error('Use an owner-only private parent directory (0700).');
// Exclusive creation is intentional: never overwrite the key of an existing install.
const handle=await open(output,'wx',0o600);
try{await handle.writeFile(JSON.stringify(config,null,2)+'\n');await handle.sync();}finally{await handle.close();}
console.log('Private configuration created. Existing configurations are never overwritten. Back up this file securely; no secret was printed.');
