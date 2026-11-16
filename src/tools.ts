import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AccountStore, UapiParameters } from "./types.js";
import { UapiClient } from "./uapi.js";
import { WhmClient } from "./whm.js";
import type { StagedUploadStore } from "./hosted/staged-upload.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const parameterSchema = z.record(z.string(), z.union([scalar, z.array(scalar), z.null()])).default({});

function textResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function toolAuthMeta(scopes: string[], local: boolean) {
  return { securitySchemes: local ? [{ type: "noauth" as const }] : [{ type: "oauth2" as const, scopes }] };
}

export function createCpanelMcpServer(store: AccountStore, client = new UapiClient(), whmClient = new WhmClient(), options: { local?: boolean; stagedUploads?: StagedUploadStore } = {}): McpServer {
  const server = new McpServer({ name: "PARMTECH cPanel and WHM Connector", version: "0.2.0-alpha.3" });
  const auth = (scopes: string[]) => toolAuthMeta(scopes, options.local === true);

  server.registerTool(
    "cpanel_list_accounts",
    {
      title: "List connected hosting account profiles",
      description: "List your connected cPanel and WHM account profiles. Each stable, opaque accountId selects exactly one connection; labels and access level help distinguish profiles. Credentials are never returned.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: auth(["accounts:read"]),
    },
    async () => textResult(await store.list()),
  );

  server.registerTool(
    "whm_api_read",
    {
      title: "Read WHM server information",
      description: "Read server information through a conservative allowlist of read-only WHM API 1 functions (version, gethostname, loadavg, listaccts, accountsummary, listresellers, listzones, listpkgs, listservices, servicestatus). Results may include information about multiple hosting accounts. Requires whm:read authorization and a WHM connection with matching API permissions.",
      inputSchema: {
        accountId: z.string().uuid().describe("Connection ID from cpanel_list_accounts where access level is WHM"),
        function: z.enum(["version", "gethostname", "loadavg", "listaccts", "accountsummary", "listresellers", "listzones", "listpkgs", "listservices", "servicestatus"]),
        parameters: parameterSchema.describe("WHM API 1 query parameters"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: auth(["whm:read"]),
    },
    async ({ accountId, function: functionName, parameters }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await whmClient.readOnly(credentials, functionName, parameters as UapiParameters));
    },
  );

  server.registerTool(
    "whm_api_execute",
    {
      title: "Execute a WHM API 1 function",
      description: "Run a WHM API 1 function with server-level privileges from the selected WHM connection. This can affect multiple hosting accounts or the entire server. Review function and parameters carefully; permission is controlled by the WHM user and token. This tool requires the whm:write authorization scope even for read operations.",
      inputSchema: {
        accountId: z.string().uuid().describe("Connection ID from cpanel_list_accounts where access level is WHM"),
        function: z.string().min(1).describe("WHM API 1 function, such as listaccts or accountsummary"),
        parameters: parameterSchema.describe("WHM API 1 query parameters"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["whm:write"]),
    },
    async ({ accountId, function: functionName, parameters }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await whmClient.call(credentials, functionName, parameters as UapiParameters));
    },
  );

  server.registerTool(
    "cpanel_list_domains",
    {
      title: "List cPanel domains",
      description: "List primary, addon, parked, and subdomains for the selected cPanel account using DomainInfo::list_domains.",
      inputSchema: { accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: auth(["cpanel:read"]),
    },
    async ({ accountId }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.call(credentials, "DomainInfo", "list_domains"));
    },
  );

  server.registerTool(
    "cpanel_list_email_accounts",
    {
      title: "List cPanel email accounts",
      description: "List email mailboxes for the selected cPanel account using Email::list_pops.",
      inputSchema: { accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: auth(["cpanel:read"]),
    },
    async ({ accountId }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.call(credentials, "Email", "list_pops"));
    },
  );

  server.registerTool(
    "cpanel_list_files",
    {
      title: "List files in a cPanel directory",
      description: "List files and directories with cPanel Fileman::list_files. Provide a path such as public_html or /home/username/public_html.",
      inputSchema: {
        accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts"),
        directory: z.string().min(1).describe("Directory path to list"),
        showDotFiles: z.boolean().optional().describe("Include dotfiles when supported by this cPanel version"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: auth(["cpanel:read"]),
    },
    async ({ accountId, directory, showDotFiles }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.call(credentials, "Fileman", "list_files", {
        dir: directory,
        ...(showDotFiles === undefined ? {} : { showdotfiles: showDotFiles ? 1 : 0 }),
      }));
    },
  );

  server.registerTool(
    "cpanel_create_email_account",
    {
      title: "Create a cPanel email account",
      description: "Create a mailbox with Email::add_pop. This changes the cPanel account. The mailbox password is sent to cPanel over HTTPS and is not stored by this connector.",
      inputSchema: {
        accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts"),
        email: z.string().min(1).describe("Mailbox local part, for example support, or full address"),
        domain: z.string().min(1).optional().describe("Mailbox domain; omit to use the cPanel main domain"),
        password: z.string().min(1).describe("New mailbox password"),
        quotaMb: z.number().int().nonnegative().optional().describe("Mailbox quota in MB; 0 means unlimited where permitted"),
        sendWelcomeEmail: z.boolean().optional().describe("Send cPanel's welcome instructions"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, email, domain, password, quotaMb, sendWelcomeEmail }) => {
      const { credentials } = await store.get(accountId);
      const result = await client.call(credentials, "Email", "add_pop", {
        email,
        password,
        ...(domain ? { domain } : {}),
        ...(quotaMb === undefined ? {} : { quota: quotaMb }),
        ...(sendWelcomeEmail === undefined ? {} : { send_welcome_email: sendWelcomeEmail ? 1 : 0 }),
      });
      return textResult(result);
    },
  );

  server.registerTool(
    "cpanel_delete_email_account",
    {
      title: "Delete a cPanel email account",
      description: "Delete a mailbox using Email::delete_pop. cPanel may also delete the mailbox's stored mail. This cannot be undone by the connector.",
      inputSchema: {
        accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts"),
        email: z.string().min(1).describe("Full email address to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, email }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.call(credentials, "Email", "delete_pop", { email }));
    },
  );

  server.registerTool(
    "cpanel_upload_file",
    {
      title: "Upload a file to cPanel",
      description: "Upload a file with cPanel Fileman::upload_files. Supply a direct public HTTPS file URL (up to 32 MB), or base64 file content (up to 500 KB). The source URL must not contain credentials or query parameters. The destination is within the selected cPanel account's permissions. A local path or chat attachment alone cannot be read by the remote connector.",
      inputSchema: {
        accountId: z.string().uuid().describe("cPanel connection ID from cpanel_list_accounts"),
        directory: z.string().min(1).describe("Destination directory, such as public_html or /home/username/public_html"),
        filename: z.string().min(1).describe("Destination filename, without path components"),
        sourceUrl: z.string().url().optional().describe("Direct public HTTPS download URL for a file up to 32 MB"),
        contentBase64: z.string().optional().describe("Base64-encoded file bytes for a file up to 500 KB"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, directory, filename, sourceUrl, contentBase64 }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.uploadFile(credentials, directory, filename, { sourceUrl, contentBase64 }));
    },
  );

  if (options.stagedUploads) {
    const staged = options.stagedUploads;
    server.registerTool("cpanel_begin_file_upload", {
      title: "Begin a large cPanel file upload",
      description: "Start a private, temporary upload for a local ZIP or other file up to 128 MB. Send the file in sequential base64 chunks with cpanel_append_file_chunk, then call cpanel_finish_file_upload. The staging area expires after two hours. If the file is accessible by a direct public HTTPS URL, cpanel_upload_file is simpler.",
      inputSchema: { accountId: z.string().uuid(), directory: z.string().min(1), filename: z.string().min(1), totalBytes: z.number().int().min(1).max(128 * 1024 * 1024), sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: auth(["cpanel:write"]),
    }, async ({ accountId, directory, filename, totalBytes, sha256 }) => {
      await store.get(accountId);
      return textResult(await staged.begin({ accountId, directory, filename, totalBytes, sha256 }));
    });
    server.registerTool("cpanel_append_file_chunk", {
      title: "Send the next file chunk",
      description: "Append up to 500 KB of base64 file bytes to a staged upload. Chunks must be sent in byte order. This only stages the file privately; it does not change cPanel yet.",
      inputSchema: { uploadId: z.string().uuid(), offset: z.number().int().nonnegative(), contentBase64: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: auth(["cpanel:write"]),
    }, async ({ uploadId, offset, contentBase64 }) => textResult(await staged.append(uploadId, offset, contentBase64)));
    server.registerTool("cpanel_finish_file_upload", {
      title: "Upload staged file to cPanel",
      description: "After all chunks arrive, verify the file length and optional SHA-256 hash, then upload it to the selected cPanel account. This may replace a file with the same name. On success, temporary staging is removed.",
      inputSchema: { uploadId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, _meta: auth(["cpanel:write"]),
    }, async ({ uploadId }) => textResult(await staged.finish(uploadId, async (meta, file) => {
      const { credentials } = await store.get(meta.accountId);
      return client.uploadStagedFile(credentials, meta.directory, meta.filename, file);
    })));
    server.registerTool("cpanel_cancel_file_upload", {
      title: "Cancel a staged file upload",
      description: "Discard a temporary upload that has not been sent to cPanel.",
      inputSchema: { uploadId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: auth(["cpanel:write"]),
    }, async ({ uploadId }) => textResult(await staged.cancel(uploadId)));
  }

  server.registerTool(
    "cpanel_extract_archive",
    {
      title: "Extract a ZIP archive in cPanel",
      description: "Extract an uploaded ZIP archive into a destination directory using cPanel's Fileman API 2 file operation. Existing files in the destination may be replaced. This legacy API is used because archive extraction is not exposed by the connector's UAPI functions.",
      inputSchema: {
        accountId: z.string().uuid(),
        archivePath: z.string().min(1).describe("Full cPanel path to the uploaded ZIP file"),
        destinationDirectory: z.string().min(1).describe("Existing destination directory"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, archivePath, destinationDirectory }) => {
      if (!/\.zip$/i.test(archivePath) || /[\r\n\0]/.test(archivePath + destinationDirectory)) throw new Error("Select a valid ZIP archive and destination.");
      const { credentials } = await store.get(accountId);
      return textResult(await client.callApi2(credentials, "Fileman", "fileop", { op: "extract", sourcefiles: archivePath, destfiles: destinationDirectory, metadata: destinationDirectory, doubledecode: "0" }));
    },
  );

  server.registerTool(
    "cpanel_api2_execute",
    {
      title: "Execute a legacy cPanel API 2 function",
      description: "Call a cPanel API 2 module/function when no UAPI equivalent exists. This legacy interface is deprecated by cPanel; prefer cpanel_uapi_execute. It can change files and account settings. Only functions permitted by the connected account will work.",
      inputSchema: {
        accountId: z.string().uuid(),
        module: z.string().min(1),
        function: z.string().min(1),
        parameters: parameterSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, module, function: functionName, parameters }) => {
      const { credentials } = await store.get(accountId);
      return textResult(await client.callApi2(credentials, module, functionName, parameters as UapiParameters));
    },
  );

  server.registerTool(
    "cpanel_uapi_execute",
    {
      title: "Execute a cPanel UAPI function",
      description: "Call a cPanel UAPI module/function with GET or form-encoded POST parameters for broad account management. This can read or change account data, delete files, alter DNS, create databases, change email, and run other operations available to the API token. Fileman::upload_files requires the separate cpanel_upload_file tool. Treat every call as potentially destructive and review the function and parameters before running it.",
      inputSchema: {
        accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts"),
        module: z.string().min(1).describe("UAPI module, for example DomainInfo, Fileman, Email, Mysql, or Dns"),
        function: z.string().min(1).describe("UAPI function name, for example list_domains or save_file_content"),
        method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method; use POST for large text values and state-changing functions when supported"),
        parameters: parameterSchema.describe("UAPI query parameters; values may be strings, numbers, booleans, or arrays"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, module, function: functionName, method, parameters }) => {
      if (module === "Fileman" && functionName === "upload_files") throw new Error("Use cpanel_upload_file for multipart file uploads.");
      const { credentials } = await store.get(accountId);
      return textResult(await client.call(credentials, module, functionName, parameters as UapiParameters, method));
    },
  );

  server.registerTool(
    "hosting_disconnect_connection",
    {
      title: "Disconnect a hosting profile",
      description: "Remove one cPanel or WHM credential connection from your hosted PARMTECH profile. This deletes the connector's encrypted copy only. It does not revoke a cPanel or WHM API token on the server; use the secure connection settings page or the hosting control panel for remote token revocation.",
      inputSchema: { accountId: z.string().uuid().describe("Connection ID from cpanel_list_accounts") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: auth(["accounts:write"]),
    },
    async ({ accountId }) => {
      const removed = await store.remove(accountId);
      return textResult({ disconnected: removed.label, kind: removed.kind, localCredentialRemoved: true, remoteTokenRevoked: false });
    },
  );

  server.registerTool(
    "cpanel_disconnect_account",
    {
      title: "Disconnect a cPanel account",
      description: "Remove one connection from this installation's operating system credential store. Set revokeRemote=true to first revoke the matching cPanel API token remotely; the token name must have been saved during setup. Local disconnect alone does not invalidate the cPanel token.",
      inputSchema: {
        accountId: z.string().uuid().describe("Account ID from cpanel_list_accounts"),
        revokeRemote: z.boolean().describe("Whether to revoke the cPanel API token on the cPanel server before deleting the local connection"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: auth(["cpanel:write"]),
    },
    async ({ accountId, revokeRemote }) => {
      const { metadata, credentials } = await store.get(accountId);
      if (metadata.kind === "whm") throw new Error("This is a WHM profile. Use hosting_disconnect_connection with accounts:write permission or disconnect it in connection settings.");
      if (revokeRemote) {
        if (!credentials.tokenName) {
          throw new Error("Remote token revocation needs the token name saved during connection setup. Reconnect with the name, or revoke it from cPanel → Security → Manage API Tokens.");
        }
        await client.call(credentials, "Tokens", "revoke", { name: credentials.tokenName });
      }
      const removed = await store.remove(accountId);
      return textResult({
        disconnected: removed.label,
        localCredentialRemoved: true,
        remoteTokenRevoked: revokeRemote,
        ...(revokeRemote ? {} : { remoteRevocationInstructions: "For full revocation, sign in to cPanel, open Security → Manage API Tokens, and revoke the token used by this connector." }),
        account: { id: metadata.id, host: metadata.host, username: metadata.username },
      });
    },
  );

  return server;
}
