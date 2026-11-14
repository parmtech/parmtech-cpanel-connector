import express, { type Express, type Request, type Response } from "express";
import { createPrivateKey } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HostedRepository } from "../hosted/repository.js";
import { HostedOAuthProvider } from "../hosted/oauth-provider.js";
import { encryptSecret, decryptSecret, opaqueToken } from "../hosted/crypto.js";
import { renderPage } from "../hosted/presentation.js";
import { allowOAuthCallback } from "../hosted/security-policy.js";
import { createPlayMcpServer, PLAY_SCOPES } from "./tools.js";
import type { PlayServiceAccount } from "./client.js";

type Session = { userId: string; email: string; csrf: string };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const secretContext = (id: string) => `play-service-account:${id}`;

export function parsePlayServiceAccount(value: string): PlayServiceAccount {
  let candidate: Record<string, unknown>;
  try { candidate = JSON.parse(value); } catch { throw Error("Paste the service account JSON from Google Cloud."); }
  if (candidate.type !== "service_account" || typeof candidate.client_email !== "string" || !candidate.client_email.endsWith(".iam.gserviceaccount.com") || typeof candidate.private_key !== "string" || candidate.token_uri !== "https://oauth2.googleapis.com/token") throw Error("This is not a Google service account key for the supported token endpoint.");
  try { createPrivateKey(candidate.private_key); } catch { throw Error("The service account private key is invalid."); }
  return { client_email: candidate.client_email, private_key: candidate.private_key, token_uri: candidate.token_uri, ...(typeof candidate.project_id === "string" ? { project_id: candidate.project_id } : {}) };
}

export async function installPlayRoutes(app: Express, repo: HostedRepository, base: URL, getUser: (req: Request) => Promise<Session | null>) {
  await repo.pool.query("CREATE TABLE IF NOT EXISTS play_service_accounts (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email text NOT NULL, encrypted text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  const resource = new URL("/play/mcp", base);
  const issuer = new URL("/play", base);
  const endpoint = (path: string) => new URL(path, base).href;
  const oauth = new HostedOAuthProvider(repo, resource, base, { scopes: PLAY_SCOPES, defaults: PLAY_SCOPES, approvalPath: "/play/oauth/approve" });
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const metadata = { issuer: issuer.href, authorization_endpoint: endpoint("/play/authorize"), token_endpoint: endpoint("/play/token"), registration_endpoint: endpoint("/play/register"), revocation_endpoint: endpoint("/play/revoke"), response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: PLAY_SCOPES };
  app.get("/.well-known/oauth-authorization-server/play", (_req, res) => res.json(metadata));
  app.get("/play/.well-known/oauth-authorization-server", (_req, res) => res.json(metadata));
  app.get("/.well-known/oauth-protected-resource/play/mcp", (_req, res) => res.json({ resource: resource.href, authorization_servers: [issuer.href], scopes_supported: PLAY_SCOPES, resource_name: "PARMTECH Play Console Connector" }));
  app.use("/play/register", limit, clientRegistrationHandler({ clientsStore: oauth.clientsStore }));
  app.use("/play/authorize", authorizationHandler({ provider: oauth }));
  app.use("/play/token", tokenHandler({ provider: oauth }));
  app.use("/play/revoke", revocationHandler({ provider: oauth }));

  const page = (res: Response, title: string, body: string, status = 200) => res.status(status).type("html").send(renderPage(title, body).replaceAll("HOSTING CONNECTOR", "PLAY CONSOLE CONNECTOR").replaceAll("HOSTING WORKSPACE", "PLAY CONSOLE WORKSPACE"));
  async function session(req: Request, res: Response, transactionId?: string) {
    const user = await getUser(req);
    if (!user) { const login = transactionId ? `/mani_admin?play_tx=${encodeURIComponent(transactionId)}` : "/mani_admin"; page(res, "Sign in to PARMTECH", `<p>Sign in with your existing PARMTECH administrator account.</p><a class="button" href="${esc(login)}">Open administrator login</a>`); return null; }
    return user;
  }
  async function serviceAccount(userId: string): Promise<PlayServiceAccount> {
    const row = (await repo.pool.query("SELECT encrypted FROM play_service_accounts WHERE user_id=$1", [userId])).rows[0];
    if (!row) throw Error("Connect a Google Play service account in PARMTECH settings first.");
    return JSON.parse(decryptSecret(row.encrypted, secretContext(userId)));
  }

  app.get("/mani_admin/play", async (req, res) => {
    const user = await session(req, res); if (!user) return;
    const isAdmin = Boolean((await repo.pool.query("SELECT 1 FROM users WHERE id=$1 AND role='admin'", [user.userId])).rows.length);
    const row = (await repo.pool.query("SELECT email,updated_at FROM play_service_accounts WHERE user_id=$1", [user.userId])).rows[0];
    page(res, "PARMTECH Play Console Connector", `<p>Connect Google Play separately from cPanel and GitHub.</p>${row ? `<p class="success">Service account saved: <strong>${esc(row.email)}</strong></p>` : '<p class="notice">Google Play is not connected yet.</p>'}<p>1. Enable the Google Play Developer API in your Google Cloud project.<br>2. Create a service account and invite its email under Play Console → Users and permissions with the app permissions you need.<br>3. Save the service account JSON key below. Keep this key private.</p>${isAdmin ? `<form method="post" action="/play/service-account"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><label>Google service account JSON<textarea name="credential" required rows="8" autocomplete="off"></textarea></label><button>Save Play Console connection</button></form>${row ? `<form method="post" action="/play/disconnect"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button>Remove Play Console credential</button></form>` : ""}` : ""}<p>MCP endpoint: <code>${esc(resource.href)}</code></p><p><a href="/mani_admin">Back to hosting connections</a></p>`);
  });
  app.post("/play/service-account", limit, async (req, res) => {
    const user = await session(req, res); if (!user) return;
    if (req.body.csrf !== user.csrf || !(await repo.pool.query("SELECT 1 FROM users WHERE id=$1 AND role='admin'", [user.userId])).rows.length) return page(res, "Permission required", "<p>Only the signed-in administrator can save this connection.</p>", 403);
    try {
      const account = parsePlayServiceAccount(String(req.body.credential ?? ""));
      await repo.pool.query("INSERT INTO play_service_accounts(user_id,email,encrypted) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,encrypted=EXCLUDED.encrypted,updated_at=now()", [user.userId, account.client_email, encryptSecret(JSON.stringify(account), secretContext(user.userId))]);
      res.redirect(303, "/mani_admin/play");
    } catch (error) { page(res, "Check Google credential", `<p>${esc(error instanceof Error ? error.message : "Invalid credential.")}</p><a href="/mani_admin/play">Try again</a>`, 400); }
  });
  app.post("/play/disconnect", limit, async (req, res) => {
    const user = await session(req, res); if (!user) return;
    if (req.body.csrf !== user.csrf || !(await repo.pool.query("SELECT 1 FROM users WHERE id=$1 AND role='admin'", [user.userId])).rows.length) return page(res, "Permission required", "<p>Only the signed-in administrator can remove this connection.</p>", 403);
    await repo.pool.query("DELETE FROM play_service_accounts WHERE user_id=$1", [user.userId]);
    res.redirect(303, "/mani_admin/play");
  });

  app.get("/play/oauth/approve", async (req, res) => {
    const tx = await repo.getAuthorizationTransaction(String(req.query.tx ?? ""));
    if (!tx || tx.resource !== resource.href) return page(res, "Authorization request expired", "<p>Start a fresh Play Console plugin connection.</p>", 400);
    const user = await session(req, res, tx.id); if (!user) return;
    const connected = (await repo.pool.query("SELECT email FROM play_service_accounts WHERE user_id=$1", [user.userId])).rows[0];
    if (!connected) return page(res, "Connect Play Console first", '<p>Save the Google service account, then restart the plugin connection.</p><a class="button" href="/mani_admin/play">Play Console settings</a>', 409);
    allowOAuthCallback(res, tx.redirectUri);
    const client = await repo.getClient(tx.clientId);
    page(res, "Authorize PARMTECH Play Console", `<p>Client: ${esc(client?.client_name ?? "MCP client")}<br>Returns to: ${esc(new URL(tx.redirectUri).origin)}<br>Google service account: ${esc(connected.email)}</p><form method="post" action="/play/oauth/consent"><input type="hidden" name="tx" value="${esc(tx.id)}"><input type="hidden" name="csrf" value="${esc(user.csrf)}">${tx.scopes.filter(s => PLAY_SCOPES.includes(s)).map(s => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked> ${esc(s === "play:write" ? "Manage Play Console apps and releases" : s === "play:read" ? "Read Play Console data" : "Keep the connection active")}</label>`).join("")}<button>Authorize connection</button></form>`);
  });
  app.post("/play/oauth/consent", limit, async (req, res) => {
    const user = await getUser(req);
    if (!user || req.body.csrf !== user.csrf) return page(res, "Sign in required", "<p>Sign in and restart the connection.</p>", 403);
    const tx = await repo.getAuthorizationTransaction(String(req.body.tx ?? ""));
    if (!tx || tx.resource !== resource.href) return page(res, "Authorization request expired", "<p>Start a fresh Play Console plugin connection.</p>", 400);
    if (!(await repo.pool.query("SELECT 1 FROM play_service_accounts WHERE user_id=$1", [user.userId])).rows.length) return page(res, "Play Console connection required", '<a href="/mani_admin/play">Connect Google Play</a>', 409);
    const submitted: string[] = Array.isArray(req.body.scope) ? req.body.scope.map(String) : [String(req.body.scope ?? "")];
    const scopes = [...new Set(submitted.filter(s => PLAY_SCOPES.includes(s) && tx.scopes.includes(s)))];
    const code = opaqueToken();
    await repo.createAuthorizationCode({ code, clientId: tx.clientId, userId: user.userId, redirectUri: tx.redirectUri, challenge: tx.codeChallenge, resource: tx.resource, scopes });
    await repo.deleteAuthorizationTransaction(tx.id);
    const redirect = new URL(tx.redirectUri); redirect.searchParams.set("code", code); if (tx.state) redirect.searchParams.set("state", tx.state);
    res.redirect(302, redirect.href);
  });
  app.post("/play/mcp", requireBearerAuth({ verifier: oauth, expectedResource: resource, resourceMetadataUrl: endpoint("/.well-known/oauth-protected-resource/play/mcp") }), express.json({ limit: "1mb" }), async (req, res) => {
    const userId = req.auth?.extra?.userId;
    if (typeof userId !== "string") return res.status(401).json({ error: "Invalid Play Console authorization." });
    const server = createPlayMcpServer(() => serviceAccount(userId), new Set(req.auth?.scopes ?? []));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: "Play Console MCP request failed." }); void transport.close(); void server.close(); }
  });
  app.get("/play/mcp", (_req, res) => res.status(405).json({ error: "Use MCP Streamable HTTP POST." }));
  app.delete("/play/mcp", (_req, res) => res.status(405).json({ error: "Stateless MCP sessions cannot be deleted." }));
}
