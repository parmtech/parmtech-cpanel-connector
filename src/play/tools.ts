import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlayClient, type PlayServiceAccount } from "./client.js";

export const PLAY_SCOPES = ["play:read", "play:write", "offline_access"];
const query = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});
const body = z.record(z.string(), z.unknown());
const pkg = (value: string) => { if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value)) throw Error("Enter a valid Android package name."); return value; };

export function createPlayMcpServer(load: () => Promise<PlayServiceAccount>, scopes: Set<string>) {
  const server = new McpServer({ name: "PARMTECH Play Console Connector", version: "0.1.0" });
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
  register("play_api_write", "Manage Google Play Developer API", "Send a JSON request to the Android Publisher API. Can create edits, update tracks or listings, reply to reviews, and commit or discard edits. Publishing changes may affect users; perform only when the user asks. Binary bundle uploads are not supported by this tool.", { method: z.enum(["POST", "PUT", "PATCH", "DELETE"]), path: z.string(), query, body: body.optional() }, false, (client, args) => client.request(args.method, args.path, args.query, args.body));
  return server;
}
