import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UapiClient } from '../src/uapi.js';

for (const body of ['{}', 'null', '{"result":{}}']) {
  const api = new UapiClient(async () => new Response(body));
  await assert.rejects(api.call({ host: 'https://example.test:2083', username: 'test', apiToken: 'test-token-value' }, 'DomainInfo', 'list_domains'), /invalid UAPI response/);
}
const credentials = { host: 'https://example.test:2083', username: 'test', apiToken: 'test-token-value' };
const flatApi = new UapiClient(async () => new Response(JSON.stringify({ status: 1, data: { main_domain: 'example.test' }, errors: null })));
assert.deepEqual((await flatApi.call(credentials, 'DomainInfo', 'list_domains')).result?.data, { main_domain: 'example.test' });
const rejectedApi = new UapiClient(async () => new Response(JSON.stringify({ status: 0, errors: ['Denied test-token-value'] })));
await assert.rejects(rejectedApi.call(credentials, 'DomainInfo', 'list_domains'), /UAPI reported a failure: Denied \[REDACTED\]/);
const stdio = new Client({ name: 'local-stdio-check', version: '1.0.0' });
try {
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/src/index.js'] }));
  assert.ok((await stdio.listTools()).tools.some(t => t.name === 'cpanel_list_accounts'));
} finally { await stdio.close(); }

const port = 32000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/src/index.js', '--http'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const http = new Client({ name: 'local-http-check', version: '1.0.0' });
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'HTTP server became ready');
  const setup = await fetch(`${base}/setup`);
  assert.equal(setup.status, 200);
  assert.equal(setup.headers.get('cache-control'), 'no-store');
  assert.equal(setup.headers.get('referrer-policy'), 'same-origin');
  const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = cookie.slice(cookie.indexOf('=') + 1);
  assert.match(await setup.text(), /Test and securely save/);
  const secondTab = await fetch(`${base}/setup`, { headers: { Cookie: cookie } });
  assert.match(await secondTab.text(), new RegExp(`value="${csrf}"`));
  const submitted = await fetch(`${base}/setup/add`, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: base, Cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, host: '', label: '', username: '', apiToken: '' }),
  });
  assert.equal(submitted.status, 303, 'Valid security headers reach field validation, not Forbidden');
  assert.equal(submitted.headers.get('location'), '/setup?error=invalid-host');
  assert.equal((await fetch(`${base}/setup/add`, { method: 'POST', headers: { Origin: base }, body: '' })).status, 403);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Origin: base, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  await http.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  assert.ok((await http.listTools()).tools.some(t => t.name === 'cpanel_list_accounts'));
  const listed = await http.callTool({ name: 'cpanel_list_accounts', arguments: {} });
  assert.notEqual(listed.isError, true);
} finally {
  await http.close();
  child.kill();
}
console.log('Local checks passed: stdio and HTTP tool discovery, setup page, CSRF/origin rejection, malformed UAPI rejection. No cPanel contacted.');
