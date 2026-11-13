import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { SystemAccountStore } from "./store.js";
import { normalizeCpanelHost, validateCpanelUsername } from "./host.js";
import {renderPage} from './hosted/presentation.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const setupErrors: Record<string, string> = {
  "invalid-host": "Enter only the cPanel HTTPS hostname and optional port (usually 2083). Remove the login path, query, and cpsess portion.",
  "invalid-user": "The cPanel username format is invalid. Use your hosting account username, not your email address.",
  "invalid-label": "Connection name must contain 1 to 80 characters.",
  "invalid-token": "The API token format is invalid. Copy the token value, not its name, without spaces.",
  "duplicate": "That connection name already exists. Choose another connection name.",
  "http-401": "cPanel rejected the login (HTTP 401). Check the cPanel username and token value. Use a cPanel token, not a WHM token.",
  "http-403": "cPanel refused access (HTTP 403). Check API access, token permissions, and hosting-provider restrictions.",
  "http": "The server returned an HTTP error. Check that this is the cPanel server hostname and port 2083.",
  "network": "Could not reach cPanel over HTTPS. Check the server hostname, port 2083, internet connection, and server certificate.",
  "timeout": "The cPanel server did not respond within 30 seconds. Check its hostname and port 2083.",
  "response": "The server did not return a valid cPanel UAPI response. Check the hostname and port 2083.",
  "store": "The connection could not be saved in Windows Credential Manager or the local account file. Make sure you are signed in to Windows with your normal user account.",
  "index": "The local account list could not be read. Your saved profile file needs repair; do not delete your API token.",
  "1": "Could not save the connection. No credentials were printed or returned. Check your cPanel API access or contact your hosting provider.",
};

function setupErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^(Enter the cPanel server host|The cPanel host|Use the cPanel server address)/i.test(message)) return "invalid-host";
  if (/username \(/i.test(message)) return "invalid-user";
  if (/label must/i.test(message)) return "invalid-label";
  if (/token does not look valid/i.test(message)) return "invalid-token";
  if (/label is already/i.test(message)) return "duplicate";
  if (/HTTP 401/.test(message)) return "http-401";
  if (/HTTP 403/.test(message)) return "http-403";
  if (/cPanel returned HTTP/.test(message)) return "http";
  if (/timed out/.test(message)) return "timeout";
  if (/Could not connect/.test(message)) return "network";
  if (/cPanel returned/.test(message)) return "response";
  if (/Could not save.*credential store/.test(message)) return "store";
  if (/Could not read the local account list/.test(message)) return "index";
  return "1";
}

function page(title: string, body: string, csrf: string): string {
  return renderPage(title,`<p class="page-intro">Local setup on this Windows computer. Credentials are validated with cPanel and saved to Windows Credential Manager.</p>${body}<p class="foot">Keep this page open only on your computer. The API token is never shown again and is not sent to ChatGPT.</p>`,{local:true});
}

export function attachLocalSetupUi(app: Express, store: SystemAccountStore, port: number): void {
  const cookieName = "parmtech_local_csrf";
  const baseUrl = `http://127.0.0.1:${port}`;

  app.get("/setup", async (req: Request, res: Response) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return res.sendStatus(403);
    const existingCsrf = cookieValue(req, cookieName);
    const csrf = existingCsrf && /^[a-f0-9]{64}$/.test(existingCsrf) ? existingCsrf : randomBytes(32).toString("hex");
    res.cookie(cookieName, csrf, { httpOnly: true, sameSite: "strict", secure: false, path: "/setup", maxAge: 60 * 60 * 1000 });
    // no-referrer can make browser form POSTs send Origin: null. Keep same-origin
    // referrers so the strict Origin check below accepts real browser submissions.
    res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    const accounts = await store.list();
    const items = accounts.length
      ? accounts.map((account) => `<div class="row"><strong>${escapeHtml(account.label)}</strong><br><span class="muted">${escapeHtml(account.username)} · ${escapeHtml(account.host)}</span></div>`).join("")
      : `<div class="notice">No cPanel accounts connected yet.</div>`;
    const errorCode = typeof req.query.error === "string" ? req.query.error : "";
    const message = req.query.saved === "1" ? `<div class="notice success">Connection validated and saved.</div>` : errorCode ? `<div class="notice error">${escapeHtml(setupErrors[errorCode] ?? setupErrors["1"]!)}</div>` : "";
    const form = `<form method="post" action="/setup/add"><input type="hidden" name="csrf" value="${csrf}"><label for="label">Connection name</label><input id="label" name="label" maxlength="80" placeholder="My website" required><label for="host">cPanel server hostname</label><input id="host" name="host" autocomplete="url" placeholder="server.example.com" required><label for="username">cPanel username</label><input id="username" name="username" autocomplete="username" required><label for="tokenName">API token name (optional; enables one-click remote revoke)</label><input id="tokenName" name="tokenName" autocomplete="off"><label for="apiToken">cPanel API token</label><input id="apiToken" name="apiToken" type="password" autocomplete="new-password" required><button type="submit">Test and securely save</button></form>`;
    res.type("html").send(page("PARMTECH cPanel setup", `${message}<h2>Connected accounts</h2>${items}<h2>Add a cPanel account</h2><p class="muted">Create the token in cPanel → Security → Manage API Tokens. Use a cPanel account token, not a WHM token.</p>${form}`, csrf));
  });

  app.post("/setup/add", async (req: Request, res: Response) => {
    if (req.headers.host !== `127.0.0.1:${port}` || req.get("origin") !== baseUrl || !sameSecret(cookieValue(req, cookieName), String(req.body?.csrf ?? ""))) return res.sendStatus(403);
    try {
      const label = String(req.body?.label ?? "");
      const host = normalizeCpanelHost(String(req.body?.host ?? ""));
      const username = validateCpanelUsername(String(req.body?.username ?? ""));
      const apiToken = String(req.body?.apiToken ?? "");
      const tokenName = String(req.body?.tokenName ?? "").trim();
      await store.add({ label, host, username, apiToken, ...(tokenName ? { tokenName } : {}) });
      res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: false, path: "/setup" });
      return res.redirect(303, "/setup?saved=1");
    } catch (error) {
      res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: false, path: "/setup" });
      return res.redirect(303, `/setup?error=${setupErrorCode(error)}`);
    }
  });

  app.use("/setup", (_req: Request, res: Response) => res.sendStatus(404));
}
