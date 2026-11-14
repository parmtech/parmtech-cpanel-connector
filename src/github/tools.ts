import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubClient, GitHubApiError } from "./client.js";

export const GITHUB_SCOPES = ["github:read", "github:write", "offline_access"];
export const GITHUB_READ_TOOLS = new Set(["github_connection_status", "github_api_read"]);
const query = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});
const body = z.record(z.string(), z.unknown());
const part = (value: string) => encodeURIComponent(value);

export function createGitHubMcpServer(load: () => Promise<{ token: string; login: string; scopes: string[] }>, scopes: Set<string>) {
  const server = new McpServer({ name: "PARMTECH GitHub Connector", version: "0.1.0" });
  function register(name: string, title: string, description: string, inputSchema: Record<string, any>, readOnly: boolean, run: (client: GitHubClient, args: any, account: Awaited<ReturnType<typeof load>>) => Promise<unknown>) {
    server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true, idempotentHint: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: [readOnly ? "github:read" : "github:write"] }] } }, async args => {
      try {
        if (!scopes.has(readOnly ? "github:read" : "github:write")) throw Error("Reconnect the PARMTECH GitHub plugin and grant the required permission.");
        const account = await load();
        return { content: [{ type: "text", text: JSON.stringify(await run(new GitHubClient(account.token), args, account)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify(error instanceof GitHubApiError ? { message: error.message, status: error.status, detail: error.detail, retryAfter: error.retryAfter } : { message: error instanceof Error ? error.message : "GitHub request failed." }) }] };
      }
    });
  }
  register("github_connection_status", "Check GitHub account and permissions", "Read the connected GitHub identity and granted OAuth scopes. Does not return credentials. Some GitHub and organization policies may require additional permissions.", {}, true, async (client, _args, account) => ({ login: account.login, scopes: account.scopes, profile: await client.request("GET", "/user") }));
  register("github_api_read", "Read GitHub REST API", "Read any GitHub REST endpoint using the connected account. Supports repositories, files, settings, issues, pull requests, Actions, runners, organizations, packages and account metadata. Use pagination. Path is relative to api.github.com; credentials and external URLs cannot be supplied.", { path: z.string(), query }, true, async (client, args) => client.request("GET", args.path, args.query));
  register("github_api_write", "Manage GitHub REST API", "Execute POST, PUT, PATCH or DELETE against the GitHub API with the account's granted permissions. Supports repository creation, visibility, settings, collaborators, branches, workflows, releases, runner registration, organization and account administration. Can delete data or expose private repositories: use only for the user's requested action. No API can exceed the connected user's access. No automatic retries are performed.", { method: z.enum(["POST", "PUT", "PATCH", "DELETE"]), path: z.string(), query, body: body.optional() }, false, async (client, args) => client.request(args.method, args.path, args.query, args.body));
  register("github_create_repository", "Create a GitHub repository", "Create a repository in your own account or an organization. Defaults to private. Organization creation requires that organization's permission.", { name: z.string().min(1).max(100), description: z.string().max(2000).optional(), private: z.boolean().default(true), organization: z.string().min(1).optional(), autoInit: z.boolean().default(true) }, false, async (client, args) => client.request("POST", args.organization ? `/orgs/${part(args.organization)}/repos` : "/user/repos", {}, { name: args.name, description: args.description, private: args.private, auto_init: args.autoInit }));
  register("github_update_repository", "Change repository settings and visibility", "Change name, description, public/private visibility, archived status, merge settings and other supported repository properties. Making a repository public exposes its contents and history. Requires repository administration permission.", { owner: z.string().min(1), repo: z.string().min(1), changes: body }, false, async (client, args) => client.request("PATCH", `/repos/${part(args.owner)}/${part(args.repo)}`, {}, args.changes));
  register("github_put_file", "Create or update repository file", "Write a UTF-8 file to a repository through the Contents API. Supply the current file SHA when replacing an existing file. Supports workflow files when workflow permission is granted. Branch must already exist.", { owner: z.string().min(1), repo: z.string().min(1), path: z.string().min(1), content: z.string().max(700000), message: z.string().min(1), branch: z.string().optional(), sha: z.string().optional() }, false, async (client, args) => client.request("PUT", `/repos/${part(args.owner)}/${part(args.repo)}/contents/${args.path.split("/").map(part).join("/")}`, {}, { message: args.message, content: Buffer.from(args.content).toString("base64"), branch: args.branch, sha: args.sha }));
  register("github_graphql", "Execute GitHub GraphQL", "Execute a GitHub GraphQL query or mutation. Mutations may change or delete data; this tool always requires write permission. Supports projects and operations not exposed through REST.", { query: z.string().min(1).max(100000), variables: body.default({}) }, false, async (client, args) => client.request("POST", "/graphql", {}, { query: args.query, variables: args.variables }));
  return server;
}
