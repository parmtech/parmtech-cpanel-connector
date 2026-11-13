// Run from the private operations directory, never the public document root.
import {readFile,writeFile,chmod,open,unlink} from 'node:fs/promises';
import {createDecipheriv,X509Certificate} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const directory=process.env.PARMTECH_OPERATIONS_DIR?path.resolve(process.env.PARMTECH_OPERATIONS_DIR):path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url),acme=require('acme-client');
const lock=await open(path.join(directory,'ssl-renew.lock'),'wx',0o600).catch(()=>null);
if(!lock){console.log('Certificate maintenance is already running.');process.exit(0);}
try {
 const config=JSON.parse(await readFile(path.join(directory,'runtime.json'),'utf8'));
 const domain=new URL(config.PUBLIC_BASE_URL).hostname,zone=config.CPANEL_DNS_ZONE;
 if(typeof zone!=='string'||!(domain===zone||domain.endsWith('.'+zone)))throw Error('Set the actual cPanel DNS zone for this domain.');
 const key=Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY,'base64');
 if(key.length!==32)throw Error('Private configuration invalid');
 const envelope=(await readFile(path.join(directory,'ssl-auth.enc'),'utf8')).split('.');
 if(envelope.length!==4||envelope[0]!=='v2')throw Error('Maintenance credential invalid');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope[1],'base64url'));
 decipher.setAAD(Buffer.from('ssl-renew:'+domain));decipher.setAuthTag(Buffer.from(envelope[2],'base64url'));
 const credentials=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope[3],'base64url')),decipher.final()]).toString('utf8'));
 const host=new URL(credentials.host);
 if(host.protocol!=='https:'||host.port!=='2083'||!credentials.apiToken)throw Error('Maintenance endpoint invalid');
 const headers={Authorization:'cpanel '+credentials.username+':'+credentials.apiToken};
 async function request(endpoint,params){
  const r=await fetch(new URL(endpoint,host),{method:'POST',headers,body:new URLSearchParams(params),redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error('Hosting maintenance HTTP failure');
  return r.json();
 }
 async function zoneCall(fn,params){
  const payload=await request('/json-api/cpanel',{cpanel_jsonapi_user:credentials.username,cpanel_jsonapi_apiversion:'2',cpanel_jsonapi_module:'ZoneEdit',cpanel_jsonapi_func:fn,...params});
  const result=payload.cpanelresult;
  if(!result||result.error||result.event?.result!==1)throw Error('DNS maintenance failed');
  return result.data;
 }
 const fullchain=path.join(directory,'connector-fullchain.pem');
 let existing;try{existing=new X509Certificate(await readFile(fullchain))}catch{}
 if(existing&&new Date(existing.validTo).getTime()>Date.now()+30*86400000){
  console.log('Certificate is valid beyond the renewal window.');
 }else{
  const accountFile=path.join(directory,'letsencrypt-account.pem');
  let accountKey;try{accountKey=await readFile(accountFile)}catch(e){if(e.code!=='ENOENT')throw e;accountKey=await acme.crypto.createPrivateKey();await writeFile(accountFile,accountKey,{mode:0o600,flag:'wx'});}
  await chmod(accountFile,0o600);
  const client=new acme.Client({directoryUrl:acme.directory.letsencrypt.production,accountKey});
  const [certificateKey,csr]=await acme.crypto.createCsr({commonName:domain,altNames:[domain]});
  const certificate=await client.auto({csr,email:'info@parmtech.au',termsOfServiceAgreed:true,challengePriority:['dns-01'],skipChallengeVerification:true,
   challengeCreateFn:async(authz,challenge,value)=>{
    if(authz.identifier.value!==domain||challenge.type!=='dns-01')throw Error('Unexpected validation challenge');
    const name='_acme-challenge.'+domain+'.';
    const result=await zoneCall('add_zone_record',{domain:zone,name,type:'TXT',txtdata:value,ttl:'300',class:'IN'});
    if(result[0]?.result?.status!==1)throw Error('DNS validation publication failed');
    let visible=false;
    for(let n=0;n<24;n++){
     const r=await fetch('https://dns.google/resolve?name='+encodeURIComponent(name)+'&type=TXT',{signal:AbortSignal.timeout(10000)});
     const data=await r.json();
     if(data.Answer?.some(a=>a.type===16&&a.data.replaceAll('"','')===value)){visible=true;break;}
     await new Promise(resolve=>setTimeout(resolve,10000));
    }
    if(!visible)throw Error('DNS propagation pending');
   },
   challengeRemoveFn:async(authz,challenge,value)=>{
    const rows=await zoneCall('fetchzone_records',{domain:zone});
    const own=rows.filter(r=>r.type==='TXT'&&r.name?.replace(/\.$/,'')==='_acme-challenge.'+domain&&String(r.txtdata??'').replaceAll('"','')===value);
    for(const row of own)await zoneCall('remove_zone_record',{domain:zone,line:row.line??row.Line});
   }
  });
  const chain=certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if(!chain?.length)throw Error('Certificate chain invalid');
  const payload=await request('/execute/SSL/install_ssl',{domain,cert:chain[0],key:String(certificateKey),cabundle:chain.slice(1).join('\n')});
  if((payload.result??payload).status!==1)throw Error('Certificate installation failed');
  // Commit the new local pair only after successful server installation.
  await writeFile(path.join(directory,'connector-key.pem'),certificateKey,{mode:0o600});
  await writeFile(fullchain,certificate,{mode:0o600});
  console.log('Let’s Encrypt certificate renewed and installed successfully.');
 }
} catch {
 console.error('Connector certificate maintenance failed. Inspect private hosting configuration or DNS; secrets are not logged.');
 process.exitCode=1;
} finally {
 await lock.close();await unlink(path.join(directory,'ssl-renew.lock'));
}
