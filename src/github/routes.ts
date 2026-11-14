import express, { type Express, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HostedRepository } from "../hosted/repository.js";
import { HostedOAuthProvider } from "../hosted/oauth-provider.js";
import { allowOAuthCallback } from "../hosted/security-policy.js";
import { encryptSecret, decryptSecret, opaqueToken, hashToken } from "../hosted/crypto.js";
import { renderPage } from "../hosted/presentation.js";
import { GitHubClient } from "./client.js";
import { createGitHubMcpServer, GITHUB_SCOPES } from "./tools.js";

type Session = { userId: string; email: string; csrf: string };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const UPSTREAM_SCOPES = ["repo", "workflow", "delete_repo", "admin:org", "admin:repo_hook", "admin:org_hook", "admin:public_key", "admin:gpg_key", "user", "gist", "notifications", "project", "write:packages", "delete:packages", "codespace", "read:audit_log"];
const scopeText = UPSTREAM_SCOPES.join(" ");
const SECRET_CONTEXT = "parmtech-github-oauth-app";
const connectionContext = (id: string) => `github-account:${id}`;

export async function installGitHubRoutes(app: Express, repo: HostedRepository, base: URL, getUser: (req: Request) => Promise<Session | null>) {
  await repo.pool.query(`CREATE TABLE IF NOT EXISTS github_app_config (id integer PRIMARY KEY CHECK(id=1), encrypted text NOT NULL);
    CREATE TABLE IF NOT EXISTS github_accounts (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, login text NOT NULL, scopes text[] NOT NULL, encrypted text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS github_oauth_states (state_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);`);
  const resource = new URL("/github/mcp", base);
  const issuer = new URL("/github", base);
  const oauth = new HostedOAuthProvider(repo, resource, base, { scopes: GITHUB_SCOPES, defaults: GITHUB_SCOPES, approvalPath: "/github/oauth/approve" });
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const endpoint = (path: string) => new URL(path, base).href;
  const metadata = { issuer: issuer.href, authorization_endpoint: endpoint("/github/authorize"), token_endpoint: endpoint("/github/token"), registration_endpoint: endpoint("/github/register"), revocation_endpoint: endpoint("/github/revoke"), response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: GITHUB_SCOPES };
  app.get("/.well-known/oauth-authorization-server/github", (_req, res) => res.json(metadata));
  app.get("/github/.well-known/oauth-authorization-server", (_req, res) => res.json(metadata));
  app.get("/.well-known/oauth-protected-resource/github/mcp", (_req, res) => res.json({ resource: resource.href, authorization_servers: [issuer.href], scopes_supported: GITHUB_SCOPES, resource_name: "PARMTECH GitHub Connector" }));
  app.use("/github/register", limit, clientRegistrationHandler({ clientsStore: oauth.clientsStore }));
  app.use("/github/authorize", authorizationHandler({ provider: oauth }));
  app.use("/github/token", tokenHandler({ provider: oauth }));
  app.use("/github/revoke", revocationHandler({ provider: oauth }));

  const page = (res: Response, title: string, body: string, status = 200) => res.status(status).type("html").send(renderPage(title, body).replaceAll("HOSTING CONNECTOR", "GITHUB CONNECTOR").replaceAll("HOSTING WORKSPACE", "GITHUB WORKSPACE").replaceAll("Independent cPanel &amp; WHM integration", "Independent GitHub integration").replaceAll("Your hosting.<br>Connected, securely.", "Your GitHub.<br>Connected, securely.").replaceAll("hosting connections", "GitHub connections").replaceAll("hosting credentials", "GitHub credentials"));
  async function session(req: Request, res: Response) {
    const user = await getUser(req);
    if (!user) { page(res, "Sign in to PARMTECH", '<p>Use your existing PARMTECH connector administrator login, then return to GitHub settings.</p><a class="button" href="/mani_admin">Open administrator login</a>'); return null; }
    return user;
  }
  async function config(): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = (await repo.pool.query("SELECT encrypted FROM github_app_config WHERE id=1")).rows[0];
    return row ? JSON.parse(decryptSecret(row.encrypted, SECRET_CONTEXT)) : null;
  }
  async function account(userId: string) {
    const row = (await repo.pool.query("SELECT login,scopes,encrypted FROM github_accounts WHERE user_id=$1", [userId])).rows[0];
    if (!row) throw Error("Connect GitHub in the private PARMTECH GitHub settings page first.");
    const data = JSON.parse(decryptSecret(row.encrypted, connectionContext(userId)));
    if (data.expiresAt && data.expiresAt < Date.now() + 60000) {
      // Refresh while holding a per-account transaction lock, then re-read to
      // prevent concurrent callers from consuming the same refresh token.
      const db = await repo.pool.connect();
      try {
        await db.query("BEGIN");
        const locked = (await db.query("SELECT login,scopes,encrypted FROM github_accounts WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
        if (!locked) throw Error("GitHub is disconnected. Reconnect in settings.");
        const latest = JSON.parse(decryptSecret(locked.encrypted, connectionContext(userId)));
        if (latest.expiresAt && latest.expiresAt < Date.now() + 60000) {
          const appConfig = await config();
          if (!latest.refreshToken || !appConfig) throw Error("GitHub authorization expired. Reconnect GitHub in settings.");
          const tokens = await exchange({ client_id: appConfig.clientId, client_secret: appConfig.clientSecret, grant_type: "refresh_token", refresh_token: latest.refreshToken });
          latest.token = tokens.access_token; latest.refreshToken = tokens.refresh_token ?? latest.refreshToken;
          latest.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
          await db.query("UPDATE github_accounts SET encrypted=$2,updated_at=now() WHERE user_id=$1", [userId, encryptSecret(JSON.stringify(latest), connectionContext(userId))]);
        }
        await db.query("COMMIT");
        return { token: String(latest.token), login: String(locked.login), scopes: locked.scopes as string[] };
      } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
    }
    return { token: String(data.token), login: String(row.login), scopes: row.scopes as string[] };
  }
  async function exchange(parameters: Record<string, string>) {
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(parameters) });
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!response.ok || data.error || !data.access_token) throw Error("GitHub did not complete authorization. Start a new connection from settings.");
    return data as typeof data & { access_token: string };
  }
  app.get("/mani_admin/github", async (req, res) => {
    const user = await session(req, res); if (!user) return;
    const admin = Boolean((await repo.pool.query("SELECT 1 FROM users WHERE id=$1 AND role='admin'", [user.userId])).rows.length);
    const saved = await config();
    allowOAuthCallback(res, "https://github.com/login/oauth/authorize");
    const row = (await repo.pool.query("SELECT login,scopes,updated_at FROM github_accounts WHERE user_id=$1", [user.userId])).rows[0];
    const tokenForm = admin ? `<div class="row"><h2>GitHub OAuth application</h2><p>${saved ? "Application configured. Saving replaces its credentials; existing connections keep their own grant." : "One-time setup: register your own GitHub OAuth App using the details below."}</p><p>Application name: <strong>PARMTECH GitHub Connector</strong><br>Homepage: <code>${esc(base.origin)}</code><br>Authorization callback: <code>${esc(endpoint("/github/callback"))}</code></p><p><a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">Register your GitHub OAuth App</a></p><form method="post" action="/github/app-config"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><label>Client ID<input name="clientId" required maxlength="200" autocomplete="off"></label><label>Client secret<input type="password" name="clientSecret" required maxlength="500" autocomplete="off"></label><button>Save OAuth application</button></form></div>` : "";
    page(res, "PARMTECH GitHub Connector", `<p>Private remote GitHub administration. Uses your existing PARMTECH login.</p>${req.query.error ? '<p class="error">GitHub authorization was not completed. Start a new connection.</p>' : ""}${row ? `<p class="success">Connected GitHub account: <strong>${esc(row.login)}</strong></p><p>Granted scopes: ${esc(row.scopes.join(", "))}</p>` : '<p class="notice">GitHub is not connected yet.</p>'}<div class="row"><h2>Connect your GitHub account</h2><p>Requested access: repositories and visibility, code and workflows, Actions runners, organizations, projects, packages, profile, keys and hooks. GitHub applies your account and organization policies.</p><p>Requested scopes: ${esc(scopeText)}</p>${saved ? `<form method="post" action="/github/connect"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button>${row ? "Reconnect GitHub / update permissions" : "Authorize on GitHub"}</button></form>` : '<p>Configure the OAuth application below first.</p>'}</div><p>MCP endpoint: <code>${esc(resource.href)}</code></p>${tokenForm}<p><a href="/mani_admin">Back to hosting connections</a></p>`);
  });
  app.post("/github/app-config", limit, async (req, res) => {
    const user = await session(req, res); if (!user) return;
    if (req.body.csrf !== user.csrf || !(await repo.pool.query("SELECT 1 FROM users WHERE id=$1 AND role='admin'", [user.userId])).rows.length) return page(res, "Permission required", "<p>Only the signed-in administrator can change this configuration.</p>", 403);
    const clientId = String(req.body.clientId ?? "").trim(), clientSecret = String(req.body.clientSecret ?? "").trim();
    if (!/^[A-Za-z0-9_.-]{5,200}$/.test(clientId) || !/^[A-Za-z0-9_\-.]{10,500}$/.test(clientSecret)) return page(res, "Check application details", "<p>Enter the Client ID and Client secret from your own GitHub OAuth App.</p>", 400);
    await repo.pool.query("INSERT INTO github_app_config(id,encrypted) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET encrypted=EXCLUDED.encrypted", [encryptSecret(JSON.stringify({ clientId, clientSecret }), SECRET_CONTEXT)]);
    res.redirect(303, "/mani_admin/github");
  });
  app.post("/github/connect", limit, async (req, res) => {
    const user = await session(req, res); if (!user) return;
    if (req.body.csrf !== user.csrf) return page(res, "Form expired", "<p>Reload GitHub settings.</p>", 403);
    const settings = await config(); if (!settings) return res.redirect(303, "/mani_admin/github");
    const state = opaqueToken();
    await repo.pool.query("DELETE FROM github_oauth_states WHERE expires_at<now() OR user_id=$1", [user.userId]);
    await repo.pool.query("INSERT INTO github_oauth_states(state_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [hashToken(state), user.userId]);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: endpoint("/github/callback"), scope: scopeText, state }).toString();
    res.redirect(303, url.href);
  });
  app.get("/github/callback", limit, async (req, res) => {
    const user = await getUser(req); if (!user) return res.redirect(303, "/mani_admin");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!state || !code || req.query.error) return res.redirect(303, "/mani_admin/github?error=1");
    const valid = (await repo.pool.query("DELETE FROM github_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING user_id", [hashToken(state), user.userId])).rows.length;
    if (!valid) return page(res, "GitHub authorization expired", '<p>Start a new GitHub authorization from <a href="/mani_admin/github">GitHub settings</a>.</p>', 400);
    try {
      const settings = await config(); if (!settings) throw Error("Application not configured.");
      const tokens = await exchange({ client_id: settings.clientId, client_secret: settings.clientSecret, code, redirect_uri: endpoint("/github/callback") });
      const profile = await new GitHubClient(tokens.access_token).request("GET", "/user");
      const login = (profile.data as { login: string }).login;
      const scopes = tokens.scope?.split(/[, ]+/).filter(Boolean) ?? profile.grantedScopes;
      await repo.pool.query("INSERT INTO github_accounts(user_id,login,scopes,encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET login=EXCLUDED.login,scopes=EXCLUDED.scopes,encrypted=EXCLUDED.encrypted,updated_at=now()", [user.userId, login, scopes, encryptSecret(JSON.stringify({ token: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined }), connectionContext(user.userId))]);
      res.redirect(303, "/mani_admin/github");
    } catch { return page(res, "GitHub connection incomplete", '<p>GitHub did not complete the connection. Check the application credentials and retry from <a href="/mani_admin/github">GitHub settings</a>.</p>', 400); }
  });

  app.get("/github/oauth/approve", async (req, res) => {
    const tx = await repo.getAuthorizationTransaction(String(req.query.tx ?? ""));
    if (!tx || tx.resource !== resource.href) return page(res, "Authorization request expired", "<p>Start a fresh GitHub plugin connection.</p>", 400);
    const user = await session(req, res); if (!user) return;
    const connected = (await repo.pool.query("SELECT login FROM github_accounts WHERE user_id=$1", [user.userId])).rows[0];
    if (!connected) return page(res, "Connect GitHub first", '<p>Authorize GitHub, then restart the plugin connection.</p><a class="button" href="/mani_admin/github">GitHub settings</a>', 409);
    allowOAuthCallback(res, tx.redirectUri);
    const client = await repo.getClient(tx.clientId);
    page(res, "Authorize PARMTECH GitHub", `<p>Client: ${esc(client?.client_name ?? "MCP client")}<br>Returns to: ${esc(new URL(tx.redirectUri).origin)}<br>GitHub account: ${esc(connected.login)}</p><p>This client can use the permissions selected below, limited by your GitHub grant.</p><form method="post" action="/github/oauth/consent"><input type="hidden" name="tx" value="${esc(tx.id)}"><input type="hidden" name="csrf" value="${esc(user.csrf)}">${tx.scopes.filter(s => GITHUB_SCOPES.includes(s)).map(s => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked> ${esc(s === "github:write" ? "Manage GitHub, including repository settings, visibility and deletion" : s === "github:read" ? "Read GitHub account and repositories" : "Keep the connection active")}</label>`).join("")}<button>Authorize connection</button></form>`);
  });
  app.post("/github/oauth/consent", limit, async (req, res) => {
    const user = await getUser(req);
    if (!user || req.body.csrf !== user.csrf) return page(res, "Sign in required", "<p>Sign in and restart the connection.</p>", 403);
    const tx = await repo.getAuthorizationTransaction(String(req.body.tx ?? ""));
    if (!tx || tx.resource !== resource.href) return page(res, "Authorization request expired", "<p>Start a fresh GitHub plugin connection.</p>", 400);
    if (!(await repo.pool.query("SELECT 1 FROM github_accounts WHERE user_id=$1", [user.userId])).rows.length) return page(res, "GitHub connection required", '<a href="/mani_admin/github">Connect GitHub</a>', 409);
    const submitted: string[] = Array.isArray(req.body.scope) ? req.body.scope.map(String) : [String(req.body.scope ?? "")];
    const scopes = [...new Set(submitted.filter(s => GITHUB_SCOPES.includes(s) && tx.scopes.includes(s)))];
    const code = opaqueToken();
    await repo.createAuthorizationCode({ code, clientId: tx.clientId, userId: user.userId, redirectUri: tx.redirectUri, challenge: tx.codeChallenge, resource: tx.resource, scopes });
    await repo.deleteAuthorizationTransaction(tx.id);
    const redirect = new URL(tx.redirectUri); redirect.searchParams.set("code", code); if (tx.state) redirect.searchParams.set("state", tx.state);
    res.redirect(302, redirect.href);
  });
  app.post("/github/mcp", requireBearerAuth({ verifier: oauth, expectedResource: resource, resourceMetadataUrl: endpoint("/.well-known/oauth-protected-resource/github/mcp") }), express.json({ limit: "1mb" }), async (req, res) => {
    const userId = req.auth?.extra?.userId;
    if (typeof userId !== "string") return res.status(401).json({ error: "Invalid GitHub authorization." });
    const server = createGitHubMcpServer(() => account(userId), new Set(req.auth?.scopes ?? []));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: "GitHub MCP request failed." }); void transport.close(); void server.close(); }
  });
  app.get("/github/mcp", (_req, res) => res.status(405).json({ error: "Use MCP Streamable HTTP POST." }));
  app.delete("/github/mcp", (_req, res) => res.status(405).json({ error: "Stateless MCP sessions cannot be deleted." }));
}
