import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {renderPage,renderDashboard} from '../src/hosted/presentation.js';
import {setupCodeEmail,profileVerificationEmail} from '../src/hosted/email-templates.js';

const code=setupCodeEmail('12345678');
assert.equal(code.subject,'Your PARMTECH administrator setup code');
assert.ok(code.text.includes('15 minutes')&&code.html.includes('12345678'));
assert.throws(()=>setupCodeEmail('<script>'));
const verification=profileVerificationEmail('https://connector.example.test/verify?token=a&tx=b');
assert.ok(verification.html.includes('token=a&amp;tx=b'));
assert.throws(()=>profileVerificationEmail('javascript:alert(1)'));
const secret='never-render-this-private-token';
const accounts=[{id:'one',label:'<script>alert(1)</script>',host:'https://cpanel.example.test:2083',username:'owner',createdAt:'2026-01-01',kind:'cpanel' as const,authType:'token' as const,tokenName:'owner-token',apiToken:secret},
 {id:'two',label:'WHM test',host:'https://whm.example.test:2087',username:'owner',createdAt:'2026-01-01',kind:'whm' as const,authType:'password' as const}];
const body=renderDashboard({email:'owner@example.test',csrf:'csrf-fixture'},accounts,'<form></form>','https://connector.example.test/mcp');
assert.ok(body.includes('<strong>2</strong>'));
assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!body.includes(secret)&&!body.includes('<script>'));
assert.ok(body.includes('name="csrf" value="csrf-fixture"')&&body.includes('/accounts/remove'));
const dashboard=renderPage('Connection settings',body);
assert.ok(dashboard.includes('aria-label="Workspace"')&&dashboard.includes('Hosting connections'));
const setup=renderPage('First-time admin setup','<form></form>');
assert.ok(setup.includes('Setup progress')&&setup.includes('lang="en"')&&setup.includes('name="viewport"'));
assert.ok(renderPage('Local setup','',{local:true}).includes('Private local setup'));
const forbidden=/[\u0900-\u0d7f]/u;
for(const message of [code,verification])assert.ok(!forbidden.test(message.subject+message.text+message.html));
async function scan(directory:string):Promise<void>{
 for(const name of await readdir(directory)){
  const file=path.join(directory,name),info=await stat(file);
  if(info.isDirectory()){await scan(file);continue;}
  if(!/\.(ts|mjs|cjs|md|html|py|json|txt|php)$/.test(file))continue;
  assert.ok(!forbidden.test(await readFile(file,'utf8')),'Non-English script in product source/documentation: '+file);
 }
}
for(const directory of ['src','deploy','docs'])await scan(directory);
console.log('Presentation checks passed: English-only product content, branded email templates, escaped profile metadata, real counts, protected form actions and responsive page shells.');
