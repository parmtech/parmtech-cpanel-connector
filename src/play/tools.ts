import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlayClient, type PlayServiceAccount } from "./client.js";
import { PlayBundleStore } from "./bundle-store.js";

export const PLAY_SCOPES = ["play:read", "play:write", "offline_access"];
const query = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});
const body = z.record(z.string(), z.unknown());
const pkg = (value: string) => { if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value)) throw Error("Enter a valid Android package name."); return value; };

export function createPlayMcpServer(load: () => Promise<PlayServiceAccount>, scopes: Set<string>, uploads?: PlayBundleStore) {
  const server = new McpServer({ name: "PARMTECH Play Console Connector", version: "0.2.0" });
  const store = () => { if (!uploads) throw Error("Play bundle staging is unavailable in this server."); return uploads; };
  function register(name: string, title: string, description: string, inputSchema: Record<string, any>, readOnly: boolean, run: (client: PlayClient, args: any, account: PlayServiceAccount) => Promise<unknown>) {
    server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true, idempotentHint: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: [readOnly ? "play:read" : "play:write"] }] } }, async args => {
      try {
        if (!scopes.has(readOnly ? "play:read" : "play:write")) throw Error("Reconnect the Play Console plugin with the required permission.");
        const account = await load();
        return { content: [{ type: "text", text: JSON.stringify(await run(new PlayClient(account), args, account)) }] };
      } catch (error) { return { isError: true, content: [{ type: "text", text: JSON.stringify({ message: error instanceof Error ? error.message : "Google Play request failed." }) }] }; }
    });
  }
  register("play_connection_status", "Check Play Console connection", "Check the saved service account and obtain a Google access token. This does not prove access to a particular app; use play_check_app for that.", {}, true, async (client, _args, account) => { await client.accessToken(); return { connectedToGoogle: true, serviceAccount: account.client_email }; });
  register("play_check_app", "Check Play Console app access", "Read reviews for an existing Android app to confirm that this service account can access its package.", { packageName: z.string() }, true, (client, args) => client.request("GET", `/androidpublisher/v3/applications/${pkg(args.packageName)}/reviews`, { maxResults: 1 }));
  register("play_api_read", "Read Google Play Developer API", "Read an Android Publisher API endpoint for app details, reviews, releases, store listings or account users. Path must begin with the API's applications or developers resource.", { path: z.string(), query }, true, (client, args) => client.request("GET", args.path, args.query));
  register("play_api_write", "Manage Google Play Developer API", "Send a JSON request to the Android Publisher API. Can create edits, update tracks or listings, reply to reviews, and commit or discard edits. Publishing changes may affect users; perform only when the user asks. To upload an AAB use play_begin_bundle_upload, play_append_bundle_chunk and play_finish_bundle_upload.", { method: z.enum(["POST", "PUT", "PATCH", "DELETE"]), path: z.string(), query, body: body.optional() }, false, (client, args) => client.request(args.method, args.path, args.query, args.body));
  register("play_begin_bundle_upload", "Stage Android App Bundle", "Start a private AAB upload up to 1 GB for an existing Play edit. Requires the exact file size and SHA-256. Staging expires after six hours. This does not publish or upload to Google yet.", { packageName: z.string(), editId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), filename: z.string().regex(/\.aab$/i), totalBytes: z.number().int().min(1).max(1_000_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }, false, async (client, args) => {
    const packageName = pkg(args.packageName);
    await client.request("GET", `/androidpublisher/v3/applications/${packageName}/edits/${args.editId}`);
    return store().begin({ accountId: packageName, directory: args.editId, filename: args.filename, totalBytes: args.totalBytes, sha256: args.sha256 });
  });
  register("play_append_bundle_chunk", "Send Android bundle chunk", "Append up to 500 KB of base64 file bytes in order to a private Play bundle upload. Use the acknowledged receivedBytes as the next offset. No Google upload or publishing occurs.", { uploadId: z.string().uuid(), offset: z.number().int().min(0), contentBase64: z.string().max(666672) }, false, (_client, args) => store().append(args.uploadId, args.offset, args.contentBase64));
  register("play_bundle_upload_status", "Read Android bundle upload progress", "Read this user's private bundle staging progress or its completed Google Play receipt. Does not publish.", { uploadId: z.string().uuid() }, true, (_client, args) => store().status(args.uploadId));
  register("play_finish_bundle_upload", "Upload verified AAB to Google Play", "Verify file length and SHA-256, then upload the staged AAB to its original Google Play edit with the saved service account. Returns Google's versionCode and SHA-256. Does not update tracks or commit/publish the edit. On an uncertain network failure check status and retry; matching uploaded bundles are reused.", { uploadId: z.string().uuid() }, false, (client, args) => store().finish(args.uploadId, (meta, file) => client.uploadBundle(meta.accountId, meta.directory, file, meta.sha256!)));
  register("play_cancel_bundle_upload", "Discard staged Android bundle", "Discard this user's temporary staged file. Does not delete a bundle from Google Play or modify a release.", { uploadId: z.string().uuid() }, false, (_client, args) => store().cancel(args.uploadId));
  return server;
}
