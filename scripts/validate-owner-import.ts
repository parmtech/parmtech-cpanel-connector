import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {encryptSecret} from '../src/hosted/crypto.js';
import {importOwnerConnection} from '../src/hosted/owner-import.js';
import type {AccountMetadata} from '../src/types.js';
const dir=await mkdtemp(path.join(os.tmpdir(),'parmtech-import-'));
process.env.CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
process.env.PUBLIC_BASE_URL='https://connector.example.test';
process.env.OWNER_CONNECTION_EMAIL='owner@example.test';
process.env.OWNER_CONNECTION_IMPORT_FILE=path.join(dir,'source.enc');
const credentials={host:'https://cpanel.example.test:2083',username:'owner',apiToken:'test-only-token-value'};
await writeFile(process.env.OWNER_CONNECTION_IMPORT_FILE,encryptSecret(JSON.stringify(credentials),'ssl-renew:connector.example.test'),{mode:0o600});
let verified=true,validations=0,added=0;
const accounts:AccountMetadata[]=[];
const repo={
 async isEmailVerified(){return verified},
 async listAccounts(){return accounts},
 async addAccount(_id:string,input:{label:string;host:string;username:string}){
  const account={...input,id:randomUUID(),createdAt:new Date().toISOString()};accounts.push(account);added++;return account;
 }
};
const user={userId:randomUUID(),email:'owner@example.test'};
const validate=async()=>{validations++};
await importOwnerConnection(repo,{...user,email:'other@example.test'},validate);
assert.equal(added,0,'other signed-in users must never receive the operator connection');
verified=false;await importOwnerConnection(repo,user,validate);assert.equal(added,0,'unverified owner must not import');
verified=true;await importOwnerConnection(repo,user,validate);assert.equal(added,1);assert.equal(validations,1);
await importOwnerConnection(repo,user,validate);assert.equal(added,1);
accounts.length=0;await importOwnerConnection(repo,user,validate);assert.equal(added,1,'explicit disconnect must not silently recreate the connection');
await writeFile(process.env.OWNER_CONNECTION_IMPORT_FILE,encryptSecret(JSON.stringify(credentials),'wrong-context'));
await assert.rejects(importOwnerConnection(repo,{...user,userId:randomUUID()},validate));
console.log('Owner migration checks passed: verified identity only, validation, one-time import, intentional disconnect preserved, authenticated encryption enforced.');
