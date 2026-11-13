import {readFile,open} from 'node:fs/promises';
import {randomBytes,createCipheriv} from 'node:crypto';
import path from 'node:path';
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(!['--config','--credentials','--output'].every(flag=>args.includes(flag)))throw Error('Use --config PRIVATE_RUNTIME.json --credentials PRIVATE_CPANEL.json --output ABSOLUTE_PRIVATE_PATH/ssl-auth.enc');
const config=JSON.parse(await readFile(value('--config'),'utf8'));
const credentials=JSON.parse(await readFile(value('--credentials'),'utf8'));
const output=value('--output'),host=new URL(credentials.host),domain=new URL(config.PUBLIC_BASE_URL).hostname;
if(!output||!path.isAbsolute(output)||path.dirname(output)!==path.dirname(path.resolve(value('--config'))))throw Error('Keep the encrypted maintenance file next to the private configuration.');
if(host.protocol!=='https:'||host.port!=='2083'||!credentials.username||typeof credentials.apiToken!=='string'||credentials.apiToken.length<12||/\s|REPLACE_/.test(credentials.apiToken))throw Error('Supply cPanel hostname on HTTPS2083, username and API token in the private input file.');
const key=Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY,'base64');if(key.length!==32)throw Error('Invalid configured encryption key.');
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('ssl-renew:'+domain));
const ciphertext=Buffer.concat([cipher.update(JSON.stringify(credentials)),cipher.final()]);
const result=['v2',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
const handle=await open(output,'wx',0o600);try{await handle.writeFile(result);await handle.sync();}finally{await handle.close();}
console.log('Encrypted renewal credential created in private storage; no credential was printed.');
