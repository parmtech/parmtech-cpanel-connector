import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { normalizeCpanelHost } from "../src/host.js";
import { MemoryAccountStore } from "../src/store.js";
import { createCpanelMcpServer } from "../src/tools.js";
import { UapiClient, type FetchLike } from "../src/uapi.js";
import { StagedUploadStore } from "../src/hosted/staged-upload.js";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockToken = "mock-token-never-use-in-production";
const requests: Array<{ url: string; authorization: string | null; method?: string; body?: BodyInit | null }> = [];
let uploaded: { directory: string; filename: string; bytes: Uint8Array } | null = null;
const mockFetch: FetchLike = async (input, init) => {
  const url = String(input);
  const authorization = new Headers(init?.headers).get("Authorization");
  requests.push({ url, authorization, method: init?.method, body: init?.body });
  const endpoint = new URL(url);
  if (endpoint.hostname === "downloads.example.test") {
    assert.equal(authorization, null);
    assert.equal(init?.redirect, "error");
    return new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xaa]), { status: 200, headers: { "content-length": "5" } });
  }
  if (endpoint.pathname === "/json-api/cpanel") {
    assert.equal(init?.method, "POST");
    const parameters = init?.body as URLSearchParams;
    assert.equal(parameters.get("cpanel_jsonapi_module"), "Fileman");
    assert.equal(parameters.get("cpanel_jsonapi_func"), "fileop");
    assert.equal(parameters.get("op"), "extract");
    return Response.json({ cpanelresult: { event: { result: 1 }, data: [{ result: 1 }], module: "Fileman", func: "fileop" } });
  }
  if (endpoint.pathname.endsWith("/Fileman/upload_files")) {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get("file-1");
    assert.ok(file instanceof File);
    uploaded = { directory: String(init.body.get("dir")), filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    return Response.json({ apiversion: 3, module: "Fileman", func: "upload_files", result: { status: 1, data: {}, errors: null } });
  }
  const payload = endpoint.pathname.endsWith("/DomainInfo/list_domains")
    ? { apiversion: 3, module: "DomainInfo", func: "list_domains", result: { status: 1, data: { main_domain: "example.test", addon_domains: [], sub_domains: [] }, errors: null } }
    : endpoint.pathname.endsWith("/Email/add_pop")
      ? { apiversion: 3, module: "Email", func: "add_pop", result: { status: 1, data: { email: endpoint.searchParams.get("email"), password: "should-not-be-returned" }, errors: null } }
      : { apiversion: 3, module: "Tokens", func: "revoke", result: { status: 1, data: { revoked: true }, errors: null } };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
};

assert.equal(normalizeCpanelHost("cpanel.example.test"), "https://cpanel.example.test:2083");
assert.equal(normalizeCpanelHost("https://192.0.2.7:2083"), "https://192.0.2.7:2083");
assert.throws(() => normalizeCpanelHost("http://cpanel.example.test"));
assert.throws(() => normalizeCpanelHost("https://user:pass@cpanel.example.test"));
assert.throws(() => normalizeCpanelHost("https://cpanel.example.test/some/path"));

const store = new MemoryAccountStore();
const account = await store.add({
  label: "Mock cPanel",
  host: "https://cpanel.example.test:2083",
  username: "exampleuser",
  apiToken: mockToken,
  tokenName: "PARMTECH Connector Test",
});
const temporaryRoot = await mkdtemp(join(tmpdir(), "parmtech-upload-mock-"));
const staged = new StagedUploadStore("test-owner", temporaryRoot);
const mcpServer = createCpanelMcpServer(store, new UapiClient(mockFetch), undefined, { stagedUploads: staged });
const mcpClient = new Client({ name: "mock-validation", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

const toolList = await mcpClient.listTools();
const toolNames = toolList.tools.map((tool) => tool.name);
for (const required of ["cpanel_list_accounts", "cpanel_list_domains", "cpanel_list_email_accounts", "cpanel_list_files", "cpanel_create_email_account", "cpanel_delete_email_account", "cpanel_upload_file", "cpanel_begin_file_upload", "cpanel_append_file_chunk", "cpanel_finish_file_upload", "cpanel_cancel_file_upload", "cpanel_extract_archive", "cpanel_api2_execute", "cpanel_uapi_execute", "cpanel_disconnect_account"]) {
  assert.ok(toolNames.includes(required), `Missing MCP tool: ${required}`);
}

const listed = await mcpClient.callTool({ name: "cpanel_list_domains", arguments: { accountId: account.id } });
assert.equal(listed.isError, undefined);
assert.match(JSON.stringify(listed), /example\.test/);

const created = await mcpClient.callTool({
  name: "cpanel_uapi_execute",
  arguments: {
    accountId: account.id,
    module: "Email",
    function: "add_pop",
    parameters: { email: "helpdesk", domain: "example.test", password: "temporary-test-value" },
  },
});
assert.equal(created.isError, undefined);
assert.doesNotMatch(JSON.stringify(created), /should-not-be-returned|temporary-test-value|mock-token-never-use-in-production/);
assert.ok(requests.some((request) => request.url.includes("/execute/Email/add_pop") && request.url.includes("password=temporary-test-value")));
assert.ok(requests.every((request) => request.authorization === `cpanel exampleuser:${mockToken}`));

const posted = await mcpClient.callTool({ name: "cpanel_uapi_execute", arguments: { accountId: account.id, module: "Fileman", function: "list_files", method: "POST", parameters: { dir: "public_html", showdotfiles: 1 } } });
assert.equal(posted.isError, undefined);
const postRequest = requests.find(request => request.url.endsWith("/Fileman/list_files"));
assert.equal(postRequest?.method, "POST");
assert.equal((postRequest?.body as URLSearchParams).get("dir"), "public_html");

const archiveBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
const upload = await mcpClient.callTool({ name: "cpanel_upload_file", arguments: { accountId: account.id, directory: "public_html", filename: "product.zip", contentBase64: archiveBytes.toString("base64") } });
assert.equal(upload.isError, undefined);
assert.deepEqual(uploaded, { directory: "public_html", filename: "product.zip", bytes: new Uint8Array(archiveBytes) });
assert.equal(JSON.parse((upload as unknown as { content: Array<{ text: string }> }).content[0]!.text).uploaded, true);
const invalidUpload = await mcpClient.callTool({ name: "cpanel_upload_file", arguments: { accountId: account.id, directory: "public_html", filename: "../product.zip", contentBase64: archiveBytes.toString("base64") } });
assert.equal(invalidUpload.isError, true);
assert.equal(requests.filter(request => request.url.includes("/Fileman/upload_files")).length, 1);
const remoteUpload = await mcpClient.callTool({ name: "cpanel_upload_file", arguments: { accountId: account.id, directory: "public_html", filename: "remote.zip", sourceUrl: "https://downloads.example.test/remote.zip" } });
assert.equal(remoteUpload.isError, undefined);
assert.deepEqual(uploaded, { directory: "public_html", filename: "remote.zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa]) });
const unsafeSource = await mcpClient.callTool({ name: "cpanel_upload_file", arguments: { accountId: account.id, directory: "public_html", filename: "unsafe.zip", sourceUrl: "https://downloads.example.test/unsafe.zip?token=secret" } });
assert.equal(unsafeSource.isError, true);
const extracted = await mcpClient.callTool({ name: "cpanel_extract_archive", arguments: { accountId: account.id, archivePath: "/home/exampleuser/stage/product.zip", destinationDirectory: "/home/exampleuser/public_html" } });
assert.equal(extracted.isError, undefined);

const largeBytes = Buffer.alloc(700_000, 0x4b);
const sha256 = createHash("sha256").update(largeBytes).digest("hex");
const started = await mcpClient.callTool({ name: "cpanel_begin_file_upload", arguments: { accountId: account.id, directory: "public_html", filename: "large-product.zip", totalBytes: largeBytes.length, sha256 } });
assert.equal(started.isError, undefined);
const uploadId = JSON.parse((started as { content: Array<{ text: string }> }).content[0]!.text).uploadId;
await assert.rejects(() => new StagedUploadStore("different-owner", temporaryRoot).append(uploadId, 0, "aGVsbG8="), /not found|expired/i);
const wrongOffset = await mcpClient.callTool({ name: "cpanel_append_file_chunk", arguments: { uploadId, offset: 1, contentBase64: largeBytes.subarray(0, 400_000).toString("base64") } });
assert.equal(wrongOffset.isError, true);
for (const [offset, end] of [[0, 400_000], [400_000, largeBytes.length]]) {
  const chunk = await mcpClient.callTool({ name: "cpanel_append_file_chunk", arguments: { uploadId, offset, contentBase64: largeBytes.subarray(offset, end).toString("base64") } });
  assert.equal(chunk.isError, undefined);
}
const finished = await mcpClient.callTool({ name: "cpanel_finish_file_upload", arguments: { uploadId } });
assert.equal(finished.isError, undefined);
assert.deepEqual(uploaded, { directory: "public_html", filename: "large-product.zip", bytes: new Uint8Array(largeBytes) });
await assert.rejects(() => staged.append(uploadId, 0, "aGVsbG8="), /not found|expired/i);
const cancelled = await staged.begin({ accountId: account.id, directory: "public_html", filename: "cancel.zip", totalBytes: 5 });
await staged.cancel(cancelled.uploadId);
await assert.rejects(() => staged.append(cancelled.uploadId, 0, "aGVsbG8="), /already being updated|not found|expired/i);
const wrongHash = await staged.begin({ accountId: account.id, directory: "public_html", filename: "bad.zip", totalBytes: 5, sha256: "0".repeat(64) });
await staged.append(wrongHash.uploadId, 0, "aGVsbG8=");
await assert.rejects(() => staged.finish(wrongHash.uploadId, async () => { throw Error("must not upload"); }), /SHA-256/);
await staged.cancel(wrongHash.uploadId);

await mcpClient.close();
await mcpServer.close();
await rm(temporaryRoot, { recursive: true, force: true });
process.stdout.write("Mock validation passed: tool registration, UAPI auth, host validation, and secret redaction. No cPanel account was contacted.\n");
