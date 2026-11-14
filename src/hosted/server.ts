import express, { type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { Pool } from "pg";
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { HostedRepository } from "./repository.js";
import { HostedOAuthProvider, OAUTH_SCOPES } from "./oauth-provider.js";
import { assertEncryptionConfigured } from "./crypto.js";
import { createCpanelMcpServer } from "../tools.js";
import { UapiClient } from "../uapi.js";
import { WhmClient } from "../whm.js";
import type { AccountCredentials } from "../types.js";
import { publicEgressFetch, resolvePublicHost } from "./outbound.js";
import { importOwnerConnection } from "./owner-import.js";
import {renderPage,renderDashboard,renderField,renderHostingForm} from './presentation.js';
import {setupCodeEmail,profileVerificationEmail} from './email-templates.js';
import { securityHeaders, allowOAuthCallback } from "./security-policy.js";
import { installGitHubRoutes } from "../github/routes.js";
import { installPlayRoutes } from "../play/routes.js";

const baseText = process.env.PUBLIC_BASE_URL;
if (!baseText) throw new Error("PUBLIC_BASE_URL must be configured for the hosted connector.");
const baseUrl = new URL(baseText);
if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || !["", "/"].includes(baseUrl.pathname)) throw new Error("PUBLIC_BASE_URL must be an origin URL without credentials, path, query, or fragment.");
if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) throw new Error("HTTP is allowed only for local development.");
const origin = baseUrl.origin;
const companySite = new URL(process.env.COMPANY_SITE_URL ?? 'https://parmtech.au/');
if(companySite.protocol!=='https:'||companySite.username||companySite.password)throw Error('COMPANY_SITE_URL must be an HTTPS website.');
const resource = new URL("/mcp", baseUrl);
const issuer = new URL("/", baseUrl);
const secureCookie = baseUrl.protocol === "https:";
assertEncryptionConfigured();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 4,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
// An idle connection can be closed by shared hosting; pg discards it and the
// next request reconnects. Never log connection strings or database errors.
pool.on("error", () => console.error("An idle database connection closed; subsequent requests will reconnect."));
const repository = new HostedRepository(pool);
await repository.initialize();
const oauth = new HostedOAuthProvider(repository, resource, baseUrl);
const app = express();
app.use(hostHeaderValidation([baseUrl.host]));
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(securityHeaders);
await installGitHubRoutes(app, repository, baseUrl, getUser);
await installPlayRoutes(app, repository, baseUrl, getUser);
app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
  issuer: issuer.href,
  authorization_endpoint: new URL("/authorize", baseUrl).href,
  token_endpoint: new URL("/token", baseUrl).href,
  registration_endpoint: new URL("/register", baseUrl).href,
  revocation_endpoint: new URL("/revoke", baseUrl).href,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: OAUTH_SCOPES,
}));
app.use(mcpAuthRouter({
  provider: oauth,
  issuerUrl: issuer,
  baseUrl: issuer,
  resourceServerUrl: resource,
  resourceName: "PARMTECH cPanel and WHM Connector",
  scopesSupported: OAUTH_SCOPES,
}));
const authBurstLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const registrationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const accountLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const mcpLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => typeof req.auth?.extra?.userId === "string" ? req.auth.extra.userId : req.ip ?? "unknown" });

type UserSession = { userId: string; email: string; csrf: string };
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function page(title: string, body: string): string {
  return renderPage(title,body);
}
function formField(label: string, name: string, type = "text", required = true, autocomplete = "off"): string {
  return renderField(label,name,type,required,autocomplete);
}
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(rest.join("=")); } catch { return undefined; }
    }
  }
}
async function getUser(req: Request): Promise<UserSession | null> {
  const cookie = readCookie(req, "parmtech_session");
  const user = cookie ? await repository.getSession(cookie) : null;
  if (user) await importOwnerConnection(repository,user);
  return user;
}
function setSession(res: Response, cookie: string): void {
  res.cookie("parmtech_session", cookie, { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 * 1000 });
}
function verifyCsrf(user: UserSession, body: Record<string, unknown>): boolean { return typeof body.csrf === "string" && body.csrf === user.csrf; }
async function safeLocalHost(raw: string, kind: "cpanel" | "whm"): Promise<string> {
  const input = raw.trim();
  if (!input || /[\s/@?#]/.test(input)) throw new Error("Enter a server hostname only, without a path or login details.");
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  const expectedPort = kind === "cpanel" ? "2083" : "2087";
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("Use an HTTPS server hostname without a path.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("Private, reserved, and loopback server addresses cannot be connected from the hosted service.");
  await resolvePublicHost(hostname);
  if (url.port && url.port !== expectedPort) throw new Error(`Use port ${expectedPort} for ${kind.toUpperCase()} API access.`);
  url.port = expectedPort;
  return url.origin;
}
function errorPage(res: Response, title: string, message: string, status = 400): void {
  res.status(status).type("html").send(page(title, `<p class="error">${escapeHtml(message)}</p><p><a href="/mani_admin">Return to connection settings</a></p>`));
}
const mailer = process.env.MAIL_TRANSPORT === "sendmail"
  ? nodemailer.createTransport({ sendmail: true, newline: "unix", path: "/usr/sbin/sendmail" })
  : process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? "587"), secure: process.env.SMTP_SECURE === "true", requireTLS: process.env.SMTP_REQUIRE_TLS !== "false", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null;

app.get('/',(_req,res)=>res.redirect(302,companySite.href));
app.get(['/login','/settings','/setup'],(_req,res)=>res.redirect(302,'/mani_admin'));
function adminFormCsrf(req:Request,res:Response):string {
 const existing=readCookie(req,'parmtech_form_csrf');
 const csrf=existing&&/^[a-f0-9-]{36}$/i.test(existing)?existing:randomUUID();
 res.cookie('parmtech_form_csrf',csrf,{httpOnly:true,secure:secureCookie,sameSite:'lax',path:'/',maxAge:15*60*1000});
 return csrf;
}
function initialSetupPage(req:Request,res:Response):Response {
 const csrf=adminFormCsrf(req,res);
 return res.type('html').send(page('First-time admin setup',`<p>Create your administrator login once. Your connector login is separate from your cPanel credentials.</p><p>Use the owner email configured during installation. A verification code is sent to that mailbox before a password can be set.</p><form method="post" action="/mani_admin/setup/request">${formField('Owner email','email','email',true,'email')}<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>Send verification code</button></form>`));
}
app.post('/mani_admin/setup/request',registrationLimit,async(req,res)=>{
 if(await repository.adminConfigured())return res.redirect(303,'/mani_admin');
 const binding=readCookie(req,'parmtech_form_csrf');
 const email=String(req.body.email??'').trim().toLowerCase();
 const owner=(process.env.SETUP_OWNER_EMAIL??process.env.OWNER_CONNECTION_EMAIL??'').trim().toLowerCase();
 if(!binding||req.body.csrf!==binding)return errorPage(res,'Form expired','Reload the admin page and try again.',403);
 if(!owner)return errorPage(res,'Installation configuration required','Configure SETUP_OWNER_EMAIL and mail delivery on the server first.',503);
 if(email!==owner||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return errorPage(res,'Owner email required','Use the owner email configured during installation.',403);
 if(!mailer||!process.env.MAIL_FROM)return errorPage(res,'Email delivery unavailable','Configure the server mail transport before first-time setup.',503);
 try{
  const challenge=await repository.requestAdminSetup(email,binding);
  await mailer.sendMail({from:process.env.MAIL_FROM,to:email,...setupCodeEmail(challenge.code)});
  return res.type('html').send(page('Verify email and set password',`<p>A code was sent to ${escapeHtml(email)}. Keep this browser tab open.</p><form method="post" action="/mani_admin/setup/finish"><input type="hidden" name="csrf" value="${escapeHtml(binding)}"><input type="hidden" name="challenge" value="${escapeHtml(challenge.id)}">${formField('Email code (8 digits)','code','text',true,'one-time-code')}${formField('New password (12–256 characters)','password','password',true,'new-password')}${formField('Confirm new password','confirm','password',true,'new-password')}<button>Create admin login</button></form>`));
 }catch{return errorPage(res,'Could not send setup code','Check email delivery, or wait fifteen minutes before requesting another code.');}
});
app.post('/mani_admin/setup/finish',authBurstLimit,async(req,res)=>{
 const binding=readCookie(req,'parmtech_form_csrf');
 const id=String(req.body.challenge??''),code=String(req.body.code??''),password=String(req.body.password??'');
 if(!binding||req.body.csrf!==binding)return errorPage(res,'Form expired','Reload the admin page and try again.',403);
 if(!/^[a-f0-9-]{36}$/i.test(id)||!/^\d{8}$/.test(code)||password.length<12||password.length>256||password!==req.body.confirm)return errorPage(res,'Check setup details','Use the eight-digit code and matching passwords of 12–256 characters.');
 const user=await repository.finishAdminSetup(id,code,binding,password);
 if(!user)return errorPage(res,'Setup code unavailable','The code is incorrect, expired, used, or setup is already complete. Open the admin page again.',400);
 const session=await repository.createSession(user.id);setSession(res,session.cookie);
 const tx=readCookie(req,'parmtech_setup_tx');
 res.clearCookie('parmtech_setup_tx',{path:'/'});
 if(tx&&/^[a-f0-9-]{36}$/i.test(tx)&&await repository.getAuthorizationTransaction(tx))return res.redirect(303,'/oauth/approve?tx='+encodeURIComponent(tx));
 return res.redirect(303,'/mani_admin');
});
app.get("/oauth/approve", async (req, res) => {
  const txId = typeof req.query.tx === "string" ? req.query.tx : "";
  const tx = await repository.getAuthorizationTransaction(txId);
  if (!tx || tx.resource !== resource.href) return errorPage(res, "Authorization request expired", "This connection request is valid for 10 minutes and can only be used once. Start a new connection from your MCP client; refreshing this old page cannot renew it.", 400);
  if(!await repository.adminConfigured()){
    res.cookie('parmtech_setup_tx',txId,{httpOnly:true,secure:secureCookie,sameSite:'lax',path:'/',maxAge:15*60*1000});
    return res.redirect(303,'/mani_admin');
  }
  const user = await getUser(req);
  if (!user) {
    const csrf = randomUUID();
    res.cookie("parmtech_form_csrf", csrf, { httpOnly: false, secure: secureCookie, sameSite: "lax", path: "/", maxAge: 15 * 60 * 1000 });
    return res.type("html").send(page("Connect PARMTECH", `<p>Sign in or create your PARMTECH connector profile. Your hosting secrets are entered only after sign-in and are never sent in ChatGPT conversation text.</p><form method="post" action="/oauth/signup">${formField("Email", "email", "email", true, "email")}${formField("Password (12 characters minimum)", "password", "password", true, "new-password")}<input type="hidden" name="tx" value="${escapeHtml(txId)}"><input type="hidden" name="csrf" value="${csrf}"><button>Create profile</button></form><hr><form method="post" action="/oauth/login">${formField("Email", "email", "email", true, "email")}${formField("Password", "password", "password", true, "current-password")}<input type="hidden" name="tx" value="${escapeHtml(txId)}"><input type="hidden" name="csrf" value="${csrf}"><button>Sign in</button></form>`));
  }
  const accounts = await repository.listAccounts(user.userId);
  if (!accounts.length) return res.type("html").send(page("Add a hosting connection", `<p class="notice">No hosting connection is configured. Add one here to complete the OAuth connection.</p>${accountForm(user.csrf, `/accounts/add?tx=${encodeURIComponent(txId)}`)}`));
  const permissions: Array<[string, string]> = [["accounts:read", "View connected profile labels and select an account"], ["accounts:write", "Disconnect saved hosting profiles"], ["cpanel:read", "Read cPanel account data"], ["cpanel:write", "Make changes allowed by cPanel permissions"], ["whm:read", "Read server-level WHM data"], ["whm:write", "Make server-level changes allowed by WHM permissions"], ["offline_access", "Keep this connection active using refresh tokens"]];
  const checkboxes = permissions.filter(([scope]) => tx.scopes.includes(scope)).map(([scope, label]) => `<div class="permission-note"><label><input type="checkbox" name="scope" value="${scope}" ${scope === "accounts:read" || scope === "cpanel:read" || scope === "offline_access" ? "checked" : ""}> ${label}</label></div>`).join("");
  const client=await repository.getClient(tx.clientId);
  allowOAuthCallback(res, tx.redirectUri);
  return res.type("html").send(page("Authorize PARMTECH", `<p class="page-intro">Review what this client can access before you connect.</p><div class="notice"><strong>${escapeHtml(client?.client_name??'MCP client')}</strong><br><span class="helper">Application-provided name. Returns to ${escapeHtml(new URL(tx.redirectUri).origin)}.</span></div><p class="subtle">Signed in as ${escapeHtml(user.email)}.<br>Profiles: ${accounts.map((a) => `${escapeHtml(a.label)} (${a.kind?.toUpperCase() ?? "CPANEL"})`).join(", ")}</p><form method="post" action="/oauth/consent"><input type="hidden" name="tx" value="${escapeHtml(txId)}"><input type="hidden" name="csrf" value="${escapeHtml(user.csrf)}">${checkboxes}<p class="helper">WHM permissions can affect multiple hosting accounts. Only permissions already held by your hosting credential can be used.</p><button>Authorize connection</button></form><a class="return-link" href="/mani_admin">Back to hosting connections</a>`));
});

app.post("/oauth/signup", registrationLimit, async (req, res) => {
  const txId = typeof req.body.tx === "string" ? req.body.tx : "";
  const tx = await repository.getAuthorizationTransaction(txId);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const allowedEmails = process.env.REGISTRATION_ALLOWED_EMAILS?.split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (allowedEmails && !allowedEmails.includes(email)) return errorPage(res, "Registration unavailable", "This connector is restricted to its configured owner.", 403);
  if (!tx || req.body.csrf !== readCookie(req, "parmtech_form_csrf") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) return errorPage(res, "Could not create profile", "Check the email and use a password between 12 and 256 characters.");
  if (!mailer || !process.env.MAIL_FROM) return errorPage(res, "Email verification is not configured", "The service administrator must configure SMTP and MAIL_FROM before enabling new profiles.", 503);
  try {
    const created = await repository.createUser(email, password);
    const token = await repository.createVerification(created.id);
    const url = new URL(`/verify?token=${encodeURIComponent(token)}&tx=${encodeURIComponent(txId)}`, baseUrl);
    await mailer.sendMail({ from: process.env.MAIL_FROM, to: email, ...profileVerificationEmail(url.href) });
    res.type("html").send(page("Check your email", `<p>A verification link was sent to ${escapeHtml(email)}. Open it to continue connecting.</p>`));
  } catch { errorPage(res, "Could not create profile", "This email may already have a profile, or the registration service is temporarily unavailable."); }
});

app.get("/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const tx = typeof req.query.tx === "string" ? req.query.tx : "";
  const userId = await repository.verifyEmail(token);
  if (!userId || !(await repository.getAuthorizationTransaction(tx))) return errorPage(res, "Verification link expired", "Start the connection process again and request a fresh link.");
  const user = await repository.getUser(userId);
  if (!user) return errorPage(res, "Profile unavailable", "Sign in again to continue.");
  const session = await repository.createSession(userId);
  setSession(res, session.cookie);
  res.redirect(302, `/oauth/approve?tx=${encodeURIComponent(tx)}`);
});

app.post("/oauth/login", authBurstLimit, async (req, res) => {
  const tx = typeof req.body.tx === "string" ? req.body.tx : "";
  if (!(await repository.getAuthorizationTransaction(tx)) || req.body.csrf !== readCookie(req, "parmtech_form_csrf")) return errorPage(res, "Authorization expired", "Restart the connector authorization.");
  const user = await repository.authenticate(String(req.body.email ?? ""), String(req.body.password ?? ""));
  if (!user || !(await repository.isEmailVerified(user.id))) return errorPage(res, "Sign in failed", "Check your sign-in details or verify your email first.", 401);
  const session = await repository.createSession(user.id);
  setSession(res, session.cookie);
  res.redirect(302, `/oauth/approve?tx=${encodeURIComponent(tx)}`);
});

app.post("/profile/login", authBurstLimit, async (req, res) => {
  if (req.body.csrf !== readCookie(req, "parmtech_form_csrf")) return errorPage(res, "Sign-in form expired", "Reload the sign-in page and try again.", 403);
  const user = await repository.authenticate(String(req.body.email ?? ""), String(req.body.password ?? ""));
  if (!user || !(await repository.isEmailVerified(user.id))) return errorPage(res, "Sign-in failed", "Check your sign-in details or verify your email first.", 401);
  const session = await repository.createSession(user.id);
  setSession(res, session.cookie);
  const githubTx = String(req.body.github_tx ?? "");
  const pending = githubTx ? await repository.getAuthorizationTransaction(githubTx) : null;
  const githubResource = new URL("/github/mcp", baseUrl).href;
  const playTx = String(req.body.play_tx ?? "");
  const playPending = playTx ? await repository.getAuthorizationTransaction(playTx) : null;
  const playResource = new URL("/play/mcp", baseUrl).href;
  res.redirect(303, pending?.resource === githubResource ? `/github/oauth/approve?tx=${encodeURIComponent(githubTx)}` : playPending?.resource === playResource ? `/play/oauth/approve?tx=${encodeURIComponent(playTx)}` : "/mani_admin");
});

function accountForm(csrf: string, action: string): string {
  return renderHostingForm(csrf,action);
}

app.get(['/mani_admin','/mani_admin/'], async (req, res) => {
  if(!await repository.adminConfigured())return initialSetupPage(req,res);
  const user = await getUser(req);
  if (!user) {
    const csrf=adminFormCsrf(req,res);
    const githubTx = String(req.query.github_tx ?? "");
    const pending = githubTx ? await repository.getAuthorizationTransaction(githubTx) : null;
    const githubReturn = pending?.resource === new URL("/github/mcp", baseUrl).href ? `<input type="hidden" name="github_tx" value="${escapeHtml(githubTx)}">` : "";
    const playTx = String(req.query.play_tx ?? "");
    const playPending = playTx ? await repository.getAuthorizationTransaction(playTx) : null;
    const playReturn = playPending?.resource === new URL("/play/mcp", baseUrl).href ? `<input type="hidden" name="play_tx" value="${escapeHtml(playTx)}">` : "";
    return res.type('html').send(page('Admin login',`<p>Sign in using the email and password created during first-time setup. This is not your cPanel password.</p><form method="post" action="/profile/login">${formField('Email','email','email',true,'email')}${formField('Password','password','password',true,'current-password')}<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${githubReturn}${playReturn}<button>Sign in</button></form>`));
  }
  const accounts = await repository.listAccounts(user.userId);
  const notice = req.query.disconnected === "1" ? `<p class="notice">Connection disconnected${req.query.revoked === "1" ? " and its remote token was revoked" : ""}.</p>` : "";
  return res.type("html").send(page('Connection settings',renderDashboard(user,accounts,accountForm(user.csrf,'/accounts/add'),resource.href,notice + '<p><a href="/mani_admin/github">PARMTECH GitHub Connector settings →</a></p><p><a href="/mani_admin/play">PARMTECH Play Console Connector settings →</a></p>')));
});

app.post("/accounts/add", accountLimit, async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.redirect(302, "/");
  if (!verifyCsrf(user, req.body)) return errorPage(res, "Request expired", "Reload settings and try again.", 403);
  const kind = req.body.kind === "whm" ? "whm" : req.body.kind === "cpanel" ? "cpanel" : null;
  const authType = req.body.authType === "password" ? "password" : req.body.authType === "token" ? "token" : null;
  const secret = typeof req.body.secret === "string" ? req.body.secret : "";
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const tx = typeof req.query.tx === "string" ? req.query.tx : "";
  const tokenName = typeof req.body.tokenName === "string" ? req.body.tokenName.trim() : "";
  const validTokenName = !tokenName || (authType === "token" && tokenName.length <= 128 && !/[\u0000-\u001f\u007f]/.test(tokenName) && (kind !== "whm" || /^[A-Za-z0-9_-]{1,50}$/.test(tokenName)));
  if (!kind || !authType || !label || label.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(username) || !secret || secret.length > 4096 || !validTokenName) return errorPage(res, "Connection details incomplete", "Check the label, username, token name, and credential fields. Save a token name only when using an API token.");
  let stage: "validate" | "save" = "validate";
  try {
    const host = await safeLocalHost(String(req.body.host ?? ""), kind);
    const credentials: AccountCredentials = { host, username, kind, authType, ...(authType === "token" ? { apiToken: secret } : { password: secret }) };
    if (kind === "cpanel") await new UapiClient(publicEgressFetch).call(credentials, "DomainInfo", "list_domains");
    else await new WhmClient(publicEgressFetch).call(credentials, "version");
    stage = "save";
    await repository.addAccount(user.userId, { label, host, username, kind, authType, ...(authType === "token" ? { apiToken: secret } : { password: secret }), ...(authType === "token" && tokenName ? { tokenName } : {}) });
    res.redirect(303, tx ? `/oauth/approve?tx=${encodeURIComponent(tx)}` : "/settings");
  } catch (error) {
    const message = stage === "save" ? "The credentials validated, but this connection could not be saved. The label may already be in use." : error instanceof Error ? error.message : "Credential validation failed.";
    errorPage(res, "Connection was not saved", message);
  }
});

app.post("/accounts/remove", accountLimit, async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.redirect(302, "/");
  if (!verifyCsrf(user, req.body) || typeof req.body.id !== "string") return errorPage(res, "Request expired", "Reload settings and try again.", 403);
  let stage: "lookup" | "remote-revoke" | "remove" = "lookup";
  try {
    const { metadata, credentials } = await repository.getAccount(user.userId, req.body.id);
    let remoteRevoked = false;
    if (req.body.revokeRemote === "yes") {
      if (credentials.authType !== "token" || !credentials.tokenName) return errorPage(res, "Remote revocation unavailable", "Remote token revocation needs a saved token name and a token credential. The local connection was not removed.");
      stage = "remote-revoke";
      if (metadata.kind === "cpanel") await new UapiClient(publicEgressFetch).call(credentials, "Tokens", "revoke", { name: credentials.tokenName });
      else await new WhmClient(publicEgressFetch).call(credentials, "api_token_revoke", { token_name: credentials.tokenName });
      remoteRevoked = true;
    }
    stage = "remove";
    await repository.removeAccount(user.userId, req.body.id);
    res.redirect(303, `/mani_admin?disconnected=1${remoteRevoked ? "&revoked=1" : ""}`);
  }
  catch (error) {
    if (stage === "remote-revoke") return errorPage(res, "Remote token revocation failed", "The connection remains saved because the hosting server did not confirm token revocation. Check API token-management permissions and try again.");
    errorPage(res, stage === "lookup" ? "Connection not found" : "Could not disconnect", stage === "lookup" ? "That connection was already removed or is not part of this profile." : "The connection could not be removed. Try again or contact the service administrator.");
  }
});

app.post("/logout", async (req, res) => {
  const user = await getUser(req); const cookie = readCookie(req, "parmtech_session");
  if (!user || !cookie || !verifyCsrf(user, req.body)) return errorPage(res, "Request expired", "Reload settings and try again.", 403);
  await repository.deleteSession(cookie);
  res.clearCookie("parmtech_session", { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" });
  res.redirect(303, "/");
});

app.post("/oauth/consent", async (req, res) => {
  const user = await getUser(req);
  if (!user || !verifyCsrf(user, req.body)) return errorPage(res, "Sign in required", "Sign in again to authorize this connection.", 401);
  const txId = typeof req.body.tx === "string" ? req.body.tx : "";
  const tx = await repository.getAuthorizationTransaction(txId);
  if (!tx || tx.resource !== resource.href) return errorPage(res, "Authorization request expired", "This connection request is valid for 10 minutes and can only be used once. Start a new connection from your MCP client; refreshing this old page cannot renew it.", 400);
  if (!(await repository.listAccounts(user.userId)).length) return errorPage(res, "Hosting connection required", "Your sign-in is valid, but no hosting profile is saved for this account. Add a hosting connection in settings, then return to this authorization request.", 409);
  const submitted: string[] = Array.isArray(req.body.scope) ? req.body.scope.map(String) : [String(req.body.scope ?? "")];
  const scopes = [...new Set(submitted.filter((scope) => OAUTH_SCOPES.includes(scope) && tx.scopes.includes(scope)))];
  const code = randomUUID() + randomUUID().replaceAll("-", "");
  await repository.createAuthorizationCode({ code, clientId: tx.clientId, userId: user.userId, redirectUri: tx.redirectUri, challenge: tx.codeChallenge, resource: tx.resource, scopes });
  await repository.deleteAuthorizationTransaction(txId);
  const redirect = new URL(tx.redirectUri);
  redirect.searchParams.set("code", code);
  if (tx.state) redirect.searchParams.set("state", tx.state);
  res.redirect(302, redirect.href);
});

app.post("/mcp", requireBearerAuth({ verifier: oauth, expectedResource: resource, resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp` }), mcpLimit, async (req: Request, res: Response) => {
  const userId = req.auth?.extra?.userId;
  if (typeof userId !== "string") return res.status(401).json({ error: "Invalid user authorization." });
  const scopes = new Set(req.auth?.scopes ?? []);
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const missingScope = messages.map((message: any) => {
    if (message?.method !== "tools/call") return null;
    const name = message?.params?.name;
    const required = typeof name === "string"
      ? name === "cpanel_list_accounts" ? "accounts:read"
        : name === "whm_api_execute" ? "whm:write"
          : name === "whm_api_read" ? "whm:read"
            : ["cpanel_list_domains", "cpanel_list_email_accounts", "cpanel_list_files"].includes(name) ? "cpanel:read"
              : name === "hosting_disconnect_connection" ? "accounts:write"
                : ["cpanel_create_email_account", "cpanel_delete_email_account", "cpanel_upload_file", "cpanel_extract_archive", "cpanel_api2_execute", "cpanel_uapi_execute", "cpanel_disconnect_account"].includes(name) ? "cpanel:write" : ""
      : "";
    return !required || !scopes.has(required) ? { id: message?.id ?? null, required } : null;
  }).find(Boolean);
  if (missingScope) {
    const requiredScope = missingScope.required;
    const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="This tool requires the ${requiredScope || "appropriate"} permission"`;
    res.setHeader("WWW-Authenticate", challenge);
    const failure = (id: unknown) => ({
      jsonrpc: "2.0",
      id,
      result: {
        isError: true,
        content: [{ type: "text", text: "The connected ChatGPT authorization does not include permission for this tool. Reconnect and grant the requested scope." }],
        _meta: { "mcp/www_authenticate": [challenge] },
      },
    });
    return res.status(200).json(Array.isArray(req.body) ? messages.map((message: any) => failure(message?.id ?? null)) : failure(missingScope.id));
  }
  const accountStore = await repository.accountStore(userId);
  const server = createCpanelMcpServer(accountStore, new UapiClient(publicEgressFetch), new WhmClient(publicEgressFetch));
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => { void transport.close(); void server.close(); });
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed." });
    void server.close();
  }
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Use MCP Streamable HTTP POST." }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Stateless MCP sessions cannot be deleted." }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const incident = randomUUID();
  console.error(`Request failed (${incident}).`);
  if (!res.headersSent) res.status(500).type("html").send(page("Request failed", `<p>The request could not be completed. Reference: ${incident}</p>`));
});

const port = Number(process.env.PORT ?? "3210");
app.listen(port, "0.0.0.0", () => console.log(`PARMTECH hosted MCP listening on port ${port}`));
