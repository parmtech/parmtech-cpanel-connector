import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';

// Explicitly supplied disposable test database only; never auto-target a deployment.
const databaseUrl=process.env.PCC_TEST_DATABASE_URL;
if (!databaseUrl) throw Error('Set PCC_TEST_DATABASE_URL to an isolated test database.');
const base=new Pool({connectionString:databaseUrl,max:1});
const schema='pcc_http_test_'+randomBytes(8).toString('hex');
let created=false; let child:ReturnType<typeof spawn>|undefined; let message='', childError='';
const smtp=createServer((socket:Socket)=>{
 socket.setEncoding('utf8');socket.write('220 localhost fixture\r\n');let buffer='', data=false;
 socket.on('data',(chunk:string)=>{buffer+=chunk;let i:number;
  while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
   if(data){if(line==='.') {data=false;socket.write('250 queued\r\n');} else message+=line+'\n';continue;}
   if(/^EHLO/i.test(line))socket.write('250-localhost\r\n250 8BITMIME\r\n');
   else if(/^HELO|^MAIL FROM|^RCPT TO/i.test(line))socket.write('250 OK\r\n');
   else if(/^DATA/i.test(line)){message='';data=true;socket.write('354 send\r\n');}
   else if(/^QUIT/i.test(line)){socket.end('221 bye\r\n');} else socket.write('250 OK\r\n');
  }
 });
});
const listen=async(server:ReturnType<typeof createServer>)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return (server.address() as {port:number}).port;};
try {
 await base.query(`CREATE SCHEMA "${schema}"`);created=true;
 const smtpPort=await listen(smtp); const probe=createServer(); const port=await listen(probe); await new Promise<void>(r=>probe.close(()=>r()));
 const origin=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['dist/src/hosted/server.js'],{env:{...process.env,DATABASE_URL:databaseUrl,PGOPTIONS:`-c search_path=${schema}`,NODE_ENV:'test',PUBLIC_BASE_URL:origin,COMPANY_SITE_URL:'https://example.test',CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('base64'),SETUP_OWNER_EMAIL:'owner@example.test',REGISTRATION_ALLOWED_EMAILS:'owner@example.test',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtpPort),SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'false',SMTP_USER:'',SMTP_PASSWORD:'',MAIL_FROM:'fixture@example.test',PORT:String(port)},stdio:['ignore','ignore','pipe']});
 child.stderr?.on('data', chunk => { childError += String(chunk); });
 let ready=false, lastStatus='';for(let i=0;i<100;i++){try{const check=await fetch(origin+'/health');lastStatus=String(check.status)+' '+await check.text();if(check.ok){ready=true;break;}}catch(e){lastStatus=String(e);}await delay(100);}assert.ok(ready,'isolated server must start: '+lastStatus+' '+childError);
 const cookies=new Map<string,string>();
 async function request(path:string, form?:Record<string,string>){const response=await fetch(origin+path,{method:form?'POST':'GET',headers:{...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},...(form?{body:new URLSearchParams(form)}:{}),redirect:'manual'});for(const value of response.headers.getSetCookie()){const [pair]=value.split(';');const p=pair!.indexOf('=');cookies.set(pair!.slice(0,p),pair!.slice(p+1));}return {response,html:await response.text()};}
 const hidden=(html:string,name:string)=>{const match=html.match(new RegExp(`name="${name}" value="([^"]+)"`));assert.ok(match,`missing ${name}`);return match[1]!;};
 const code=()=>{const match=message.match(/\b\d{8}\b/);assert.ok(match,'fixture mail must contain code');return match[0];};
 let page=await request('/mani_admin');const csrf=hidden(page.html,'csrf');
 const invalid=await request('/profile/login',{email:'owner@example.test',password:'first-password-123'});assert.equal(invalid.response.status,403);
 page=await request('/mani_admin/setup/request',{csrf,email:'owner@example.test'});assert.equal(page.response.status,200);const challenge=hidden(page.html,'challenge');const setupCode=code();
 page=await request('/mani_admin/setup/finish',{csrf,challenge,code:setupCode,password:'first-password-123',confirm:'first-password-123'});assert.equal(page.response.status,303);
 const oldSession=cookies.get('parmtech_session');assert.ok(oldSession);
 page=await request('/recovery');const recoveryCsrf=hidden(page.html,'csrf');
 page=await request('/recovery/request',{csrf:recoveryCsrf,email:'owner@example.test'});assert.equal(page.response.status,200);const recovery=hidden(page.html,'challenge');const recoveryCode=code();
 page=await request('/recovery/finish',{csrf:recoveryCsrf,challenge:recovery,code:recoveryCode,password:'replacement-password-456',confirm:'replacement-password-456'});assert.equal(page.response.status,200);assert.match(page.html,/Password changed/);
 cookies.set('parmtech_session',oldSession); page=await request('/mani_admin');assert.match(page.html,/Admin login/);
 page=await request('/profile/login',{csrf:recoveryCsrf,email:'owner@example.test',password:'replacement-password-456'});assert.equal(page.response.status,303);
 console.log('Isolated HTTP setup and recovery passed with fixture SMTP and PostgreSQL; no external mail or cPanel used.');
} finally {if(child && child.exitCode===null && child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(r=>child!.once('exit',()=>r()));}await new Promise<void>(r=>smtp.close(()=>r()));if(created)await base.query(`DROP SCHEMA "${schema}" CASCADE`);await base.end();}
