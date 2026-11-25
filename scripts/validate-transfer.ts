import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installUploadRoutes, readLocalDownloadConfig, type UploadRouteOptions } from "../src/hosted/upload-routes.js";
import { StagedUploadStore } from "../src/hosted/staged-upload.js";
import type { AccountMetadata, AccountCredentials } from "../src/types.js";

const root = await mkdtemp(join(tmpdir(), "connector-transfer-test-"));
const downloadRoot = join(root, "downloads"), stagingRoot = join(root, "staging");
await mkdir(downloadRoot);
await writeFile(join(downloadRoot, "safe.txt"), "hello-download");
await writeFile(join(downloadRoot, "empty.txt"), "");
await writeFile(join(root, "private.txt"), "private-outside-root");
await symlink(join(root, "private.txt"), join(downloadRoot, "escape.txt"));
const accountId = "fe59b7eb-135d-4c76-8eac-f23c29b006e4";
const metadata: AccountMetadata = { id: accountId, label: 'Example <script> "quoted" & account', host: "https://cpanel.example.test:2083", username: "exampleuser", createdAt: new Date().toISOString(), kind: "cpanel" };
const credentials: AccountCredentials = { host: metadata.host, username: metadata.username, apiToken: "fixture-only-token", kind: "cpanel" };
const repository = {
  async listAccounts(userId: string) { return userId === "owner" ? [metadata] : []; },
  async getAccount(userId: string, id: string) {
    if (userId !== "owner" || id !== accountId) throw Error("Account not found.");
    return { metadata, credentials };
  },
};
let hostingAllowed = true, apiChecks = 0, uploaded: Buffer | undefined;
const client: NonNullable<UploadRouteOptions["client"]> = {
  async call(_credentials, module, fn, parameters) {
    apiChecks++;
    assert.equal(module, "Fileman"); assert.equal(fn, "list_files");
    assert.equal(parameters?.dir, downloadRoot);
    return { result: { status: hostingAllowed ? 1 : 0 } };
  },
  async uploadStagedFile(_credentials, directory, filename, file) {
    uploaded = Buffer.from(await file.arrayBuffer());
    return { uploaded: true, directory, filename, bytes: file.size };
  },
};
const app = express(); app.use(express.json());
const server = createServer(app);
const baseUrl = new URL("http://127.0.0.1");
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
baseUrl.port = String(address.port);
const getUser = async (req: express.Request) => typeof req.headers["x-test-user"] === "string" && req.headers["x-test-user"] ? { userId: req.headers["x-test-user"], csrf: "fixture-csrf" } : null;
installUploadRoutes(app, repository, baseUrl, getUser, { client, stagingRoot, localDownload: { root: downloadRoot, hostname: "cpanel.example.test", username: "exampleuser" } });
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("x-test-user")) headers.set("x-test-user", "owner");
  return fetch(new URL(path, baseUrl), { ...init, headers, redirect: "manual" });
};
const download = (path: string) => "/mani_admin/download?" + new URLSearchParams({ accountId, path });
const mutationHeaders = { Origin: baseUrl.origin, "X-PARMTECH-CSRF": "fixture-csrf" };
const begin = (body: unknown, headers: Record<string, string> = mutationHeaders) => request("/mani_admin/uploads/begin", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
try {
  assert.equal(readLocalDownloadConfig({}), null);
  assert.throws(() => readLocalDownloadConfig({ LOCAL_DOWNLOAD_ROOT: downloadRoot }), /together/);
  assert.throws(() => readLocalDownloadConfig({ LOCAL_DOWNLOAD_ROOT: "/", LOCAL_DOWNLOAD_CPANEL_HOST: "cpanel.example.test", LOCAL_DOWNLOAD_CPANEL_USERNAME: "exampleuser" }), /dedicated/);
  assert.throws(() => readLocalDownloadConfig({ LOCAL_DOWNLOAD_ROOT: downloadRoot, LOCAL_DOWNLOAD_CPANEL_HOST: "https://wrong.example.test", LOCAL_DOWNLOAD_CPANEL_USERNAME: "exampleuser" }), /invalid/);
  const page = await request("/mani_admin/uploads");
  const html = await page.text();
  assert.match(html, /&lt;script&gt; &quot;quoted&quot; &amp; account/);
  assert.match(page.headers.get("content-security-policy")!, /script-src 'nonce-/);
  assert.equal((await request(download("safe.txt"), { headers: { "x-test-user": "" } })).status, 401);
  assert.equal(apiChecks, 0);
  assert.equal((await request(download("safe.txt"), { headers: { "x-test-user": "other" } })).status, 404);
  assert.equal(apiChecks, 0);
  credentials.username = "otheruser";
  assert.equal((await request(download("safe.txt"))).status, 403);
  assert.equal(apiChecks, 0); credentials.username = "exampleuser";
  hostingAllowed = false;
  assert.equal((await request(download("safe.txt"))).status, 403); hostingAllowed = true;
  for (const path of ["../private.txt", "/private.txt", "a/../private.txt", "a\\private.txt", "a\0b"]) assert.equal((await request(download(path))).status, 400);
  assert.equal((await request(download("escape.txt"))).status, 403);
  const full = await request(download("safe.txt")); assert.equal(full.status, 200); assert.equal(await full.text(), "hello-download");
  const partial = await request(download("safe.txt"), { headers: { Range: "bytes=1-4" } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get("content-range"), "bytes 1-4/14"); assert.equal(await partial.text(), "ello");
  assert.equal((await request(download("safe.txt"), { headers: { Range: "bytes=100-200" } })).status, 416);
  const empty = await request(download("empty.txt")); assert.equal(empty.status, 200); assert.equal(await empty.text(), "");

  const input = { accountId, directory: "public_html", filename: "fixture.zip", totalBytes: 700_000 };
  assert.equal((await begin(input, {})).status, 403);
  assert.equal((await begin(input, { ...mutationHeaders, Origin: "https://wrong.example.test" })).status, 403);
  const started = await begin(input); assert.equal(started.status, 200);
  const start = await started.json() as { uploadId: string; maxBrowserChunkBytes: number; expiresInMinutes: number };
  assert.equal(start.expiresInMinutes, 360); assert.equal(start.maxBrowserChunkBytes, 8 * 1024 * 1024);
  const route = "/mani_admin/uploads/" + start.uploadId;
  assert.equal((await begin(input)).status, 400, "one active upload per user");
  assert.equal((await request(route + "/status", { headers: { "x-test-user": "other" } })).status, 404);
  const bytes = Buffer.alloc(input.totalBytes, 0x4b);
  const first = await request(route + "/chunk?offset=0", { method: "PUT", headers: { ...mutationHeaders, "Content-Type": "application/octet-stream" }, body: bytes.subarray(0, 600_000) });
  assert.equal(first.status, 200);
  const resumed = await (await request(route + "/status")).json() as { receivedBytes: number }; assert.equal(resumed.receivedBytes, 600_000);
  assert.equal((await request(route + "/chunk?offset=0", { method: "PUT", headers: { ...mutationHeaders, "Content-Type": "application/octet-stream" }, body: bytes.subarray(0, 1) })).status, 400);
  assert.equal((await request(route + "/chunk?offset=600000", { method: "PUT", headers: { ...mutationHeaders, "Content-Type": "application/octet-stream" }, body: bytes.subarray(600_000) })).status, 200);
  assert.equal((await request(route + "/finish", { method: "POST", headers: mutationHeaders })).status, 200);
  assert.deepEqual(uploaded, bytes);
  assert.equal((await request(route + "/status")).status, 404);
  const store = new StagedUploadStore("limit-owner", stagingRoot);
  const large = await store.begin({ ...input, totalBytes: 1_000_000_000 });
  assert.equal((await store.status(large.uploadId)).totalBytes, 1_000_000_000);
  await store.cancel(large.uploadId);
  await assert.rejects(() => store.begin({ ...input, totalBytes: 1_000_000_001 }), /1 GB/);
  const previousStaging = process.env.PRIVATE_UPLOAD_DIR;
  try {
    process.env.PRIVATE_UPLOAD_DIR = "relative-staging";
    assert.throws(() => new StagedUploadStore("configured-owner"), /absolute/);
    process.env.PRIVATE_UPLOAD_DIR = "";
    assert.throws(() => new StagedUploadStore("configured-owner"), /nonempty/);
    const configuredRoot = join(root, "configured-staging");
    process.env.PRIVATE_UPLOAD_DIR = configuredRoot;
    const configured = new StagedUploadStore("configured-owner");
    const item = await configured.begin({ ...input, totalBytes: 1 });
    const saved = JSON.parse(await readFile(join(configuredRoot, item.uploadId, "meta.json"), "utf8"));
    assert.equal(saved.userId, "configured-owner");
    await configured.cancel(item.uploadId);
  } finally {
    if (previousStaging === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
    else process.env.PRIVATE_UPLOAD_DIR = previousStaging;
  }
  process.stdout.write("Transfer validation passed: authenticated/CSRF uploads, resume and ownership, 1 GB boundary, download credentials, traversal/symlinks, ranges and HTML escaping. Only local fixtures were used.\n");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
}
