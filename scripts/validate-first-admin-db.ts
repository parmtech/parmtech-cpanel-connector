import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {HostedRepository} from '../src/hosted/repository.js';

// Run only with an operator-provided test connection. Every object is created
// in a new uniquely named schema, never the live public schema.
const base=new Pool({max:1}),schema='pcc_setup_test_'+randomBytes(8).toString('hex');
assert.match(schema,/^pcc_setup_test_[a-f0-9]{16}$/);
let created=false,pool:Pool|undefined;
try{
 await base.query('CREATE SCHEMA "'+schema+'"');created=true;
 pool=new Pool({max:3,options:'-c search_path='+schema});
 const repo=new HostedRepository(pool);await repo.initialize();
 assert.equal(await repo.adminConfigured(),false);
 const first=await repo.requestAdminSetup('owner@example.test','browser-a');
 assert.equal(await repo.finishAdminSetup(first.id,first.code,'browser-b','Test-only-password-123'),null);
 const wrong=first.code==='00000000'?'11111111':'00000000';
 for(let n=0;n<5;n++)assert.equal(await repo.finishAdminSetup(first.id,wrong,'browser-a','Test-only-password-123'),null);
 assert.equal(await repo.finishAdminSetup(first.id,first.code,'browser-a','Test-only-password-123'),null);
 const exhausted=await pool.query('SELECT attempts FROM setup_challenges WHERE id=$1',[first.id]);
 assert.equal(exhausted.rows[0].attempts,5);
 const expired=await repo.requestAdminSetup('owner@example.test','browser-a');
 await pool.query("UPDATE setup_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
 assert.equal(await repo.finishAdminSetup(expired.id,expired.code,'browser-a','Test-only-password-123'),null);
 const good=await repo.requestAdminSetup('owner@example.test','browser-a');
 await assert.rejects(repo.requestAdminSetup('owner@example.test','browser-a'),/fifteen/);
 const competing=await repo.requestAdminSetup('second@example.test','browser-c');
 const users=await Promise.all([
  repo.finishAdminSetup(good.id,good.code,'browser-a','Test-only-password-123'),
  repo.finishAdminSetup(competing.id,competing.code,'browser-c','Test-only-password-123')
 ]);
 assert.equal(users.filter(Boolean).length,1,'concurrent completions must create exactly one initial administrator');
 assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM users WHERE role='admin'")).rows[0].n),1);
 assert.equal(await repo.adminConfigured(),true);
 await assert.rejects(repo.requestAdminSetup('third@example.test','browser-d'),/complete/);
 assert.equal(await repo.finishAdminSetup(good.id,good.code,'browser-a','Test-only-password-123'),null);
 const user=users.find(Boolean)!;
 assert.ok(user.passwordHash.startsWith('scrypt$'));assert.notEqual(user.passwordHash,'Test-only-password-123');
 assert.equal(await repo.isEmailVerified(user.id),true);
 await pool.end();pool=new Pool({max:2,options:'-c search_path='+schema});
 const restarted=new HostedRepository(pool);
 assert.ok(await restarted.authenticate(user.email,'Test-only-password-123'));
 assert.equal(await restarted.authenticate(user.email,'wrong-password'),null);
 assert.equal(await restarted.adminConfigured(),true);
 console.log('First-admin PostgreSQL tests passed: browser binding, five-attempt limit, expiry, send throttling, one atomic admin, hashed password and persistent login. No email was sent.');
}finally{
 if(pool)await pool.end();
 if(created)await base.query('DROP SCHEMA "'+schema+'" CASCADE');
 await base.end();
}
