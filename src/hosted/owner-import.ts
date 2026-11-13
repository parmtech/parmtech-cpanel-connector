import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import type {HostedRepository} from './repository.js';
import type {AccountCredentials} from '../types.js';
import {decryptSecret} from './crypto.js';
import {UapiClient} from '../uapi.js';
import {publicEgressFetch} from './outbound.js';

/** One-time operator migration, bound to an explicitly configured verified owner.
 * A durable receipt prevents an intentional disconnect from silently reconnecting.
 * No credential or OAuth token is returned to the browser.
 */
export async function importOwnerConnection(
 repository:Pick<HostedRepository,'isEmailVerified'|'listAccounts'|'addAccount'>,
 user:{userId:string;email:string},
 validate:(credentials:AccountCredentials)=>Promise<unknown> = credentials=>new UapiClient(publicEgressFetch).call(credentials,'DomainInfo','list_domains'),
):Promise<void> {
 const file=process.env.OWNER_CONNECTION_IMPORT_FILE;
 const email=process.env.OWNER_CONNECTION_EMAIL?.trim().toLowerCase();
 if(!file||!email||user.email.toLowerCase()!==email||!await repository.isEmailVerified(user.userId))return;
 if(!/^[a-f0-9-]{36}$/i.test(user.userId)||!path.isAbsolute(file))throw Error('Owner migration configuration invalid');
 const receipt=path.join(path.dirname(file),'owner-import-'+user.userId+'.json');
 try{await access(receipt);return}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const origin=new URL(process.env.PUBLIC_BASE_URL!);
 const credentials=JSON.parse(decryptSecret(await readFile(file,'utf8'),'ssl-renew:'+origin.hostname)) as AccountCredentials;
 if(!credentials.host||!credentials.username||!credentials.apiToken)throw Error('Owner migration credentials invalid');
 const matches=(await repository.listAccounts(user.userId)).filter(a=>a.host===credentials.host&&a.username===credentials.username);
 if(!matches.length){
  await validate(credentials);
  try{await repository.addAccount(user.userId,{label:'Parmtech-Cpanel',host:credentials.host,username:credentials.username,kind:'cpanel',authType:'token',apiToken:credentials.apiToken,...(credentials.tokenName?{tokenName:credentials.tokenName}:{})});}
  catch(error){
   // Another Passenger process may have completed the same owner migration.
   const saved=await repository.listAccounts(user.userId);
   if(!saved.some(a=>a.label==='Parmtech-Cpanel'&&a.host===credentials.host&&a.username===credentials.username))throw error;
  }
 }
 try{await writeFile(receipt,JSON.stringify({imported:true,at:new Date().toISOString()}),{mode:0o600,flag:'wx'});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
}
