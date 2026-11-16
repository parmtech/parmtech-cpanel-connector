import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PlayBundleStore } from "../src/play/bundle-store.js";
import { PlayClient } from "../src/play/client.js";
import { createPlayMcpServer } from "../src/play/tools.js";

const root = await mkdtemp(join(tmpdir(), "play-upload-test-"));
const bytes = Buffer.from("PK\u0003\u0004synthetic-bundle-test-only");
const hash = createHash("sha256").update(bytes).digest("hex");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { client_email: "fixture@sample.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token" };
const receipt = { versionCode: 72, sha256: hash };
let posts = 0, uploaded = false, failAfterUpload = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === account.token_uri) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
  assert.equal(init?.redirect, "error");
  const prefix = "https://androidpublisher.googleapis.com";
  const path = "/androidpublisher/v3/applications/com.parmtech.fixture/edits/123";
  if (url === prefix + path) return Response.json({ id: "123" });
  if (url === prefix + path + "/bundles") return Response.json({ bundles: uploaded ? [receipt] : [] });
  assert.equal(url, prefix + "/upload" + path + "/bundles?uploadType=media");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("Content-Type"), "application/octet-stream");
  assert.equal(new Headers(init?.headers).get("Content-Length"), String(bytes.length));
  assert.ok(init?.body instanceof Blob);
  assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), bytes);
  posts++; uploaded = true;
  if (failAfterUpload) throw Error("Simulated lost Google response");
  return Response.json(receipt);
};
async function connect(scopes: string[], user: string) {
  const server = createPlayMcpServer(async () => account, new Set(scopes), new PlayBundleStore(user, root));
  const client = new Client({ name: "play-upload-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return { client, server, close: async () => { await client.close(); await server.close(); } };
}
const input = { packageName: "com.parmtech.fixture", editId: "123", filename: "fixture.aab", totalBytes: bytes.length, sha256: hash };
function data(result: any) { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); }
try {
  const read = await connect(["play:read"], "owner");
  assert.equal((await read.client.callTool({ name: "play_begin_bundle_upload", arguments: input })).isError, true);
  assert.equal(posts, 0); await read.close();
  const write = await connect(["play:read", "play:write"], "owner");
  assert.equal((await write.client.listTools()).tools.length, 9);
  assert.equal((await write.client.callTool({ name: "play_begin_bundle_upload", arguments: { ...input, editId: "../evil" } })).isError, true);
  const { uploadId } = data(await write.client.callTool({ name: "play_begin_bundle_upload", arguments: input }));
  const other = await connect(["play:read", "play:write"], "other-user");
  assert.equal((await other.client.callTool({ name: "play_bundle_upload_status", arguments: { uploadId } })).isError, true);
  assert.equal((await other.client.callTool({ name: "play_cancel_bundle_upload", arguments: { uploadId } })).isError, true);
  await other.close();
  assert.equal((await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId } })).isError, true);
  assert.equal(posts, 0);
  assert.equal((await write.client.callTool({ name: "play_append_bundle_chunk", arguments: { uploadId, offset: 1, contentBase64: bytes.toString("base64") } })).isError, true);
  data(await write.client.callTool({ name: "play_append_bundle_chunk", arguments: { uploadId, offset: 0, contentBase64: bytes.toString("base64") } }));
  assert.deepEqual(data(await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId } })), receipt);
  assert.deepEqual(data(await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId } })), receipt);
  assert.equal(posts, 1, "Completed transfer must not repeat the Google POST");
  assert.equal(data(await write.client.callTool({ name: "play_bundle_upload_status", arguments: { uploadId } })).phase, "completed");

  const bad = data(await write.client.callTool({ name: "play_begin_bundle_upload", arguments: { ...input, sha256: "0".repeat(64) } }));
  data(await write.client.callTool({ name: "play_append_bundle_chunk", arguments: { uploadId: bad.uploadId, offset: 0, contentBase64: bytes.toString("base64") } }));
  assert.equal((await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId: bad.uploadId } })).isError, true);
  assert.equal(posts, 1, "Checksum mismatch must never reach Google");
  data(await write.client.callTool({ name: "play_cancel_bundle_upload", arguments: { uploadId: bad.uploadId } }));

  uploaded = false; failAfterUpload = true;
  const lost = data(await write.client.callTool({ name: "play_begin_bundle_upload", arguments: input }));
  data(await write.client.callTool({ name: "play_append_bundle_chunk", arguments: { uploadId: lost.uploadId, offset: 0, contentBase64: bytes.toString("base64") } }));
  assert.equal((await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId: lost.uploadId } })).isError, true);
  assert.deepEqual(data(await write.client.callTool({ name: "play_finish_bundle_upload", arguments: { uploadId: lost.uploadId } })), receipt);
  assert.equal(posts, 2, "Lost response must reconcile the edit before posting again");
  const api = new PlayClient(account);
  await assert.rejects(api.uploadBundle("com.fixture/evil", "123", new Blob([bytes]), hash));
  await assert.rejects(api.uploadBundle("com.parmtech.fixture", "../123", new Blob([bytes]), hash));
  await write.close();
  console.log("Play bundle upload passed: binary body, destination, OAuth scopes, user isolation, checksum, offsets, receipts, lost-response recovery and no publish/commit.");
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}
