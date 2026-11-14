import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { DEFAULT_CONTENT_SECURITY_POLICY, securityHeaders, allowOAuthCallback } from "../src/hosted/security-policy.js";

// Exercise the actual response middleware over HTTP. These are fixture callback
// URLs, not live authorizations; no database, credentials, or OAuth tokens needed.
const callbacks = new Map([
  ["loopback", "http://localhost:48731/callback?existing=value"],
  ["loopback-ip", "http://127.0.0.1:49217/oauth/callback"],
  ["external", "https://chatgpt.com/connector_platform/oauth/callback"],
  ["external-port", "https://client.example:8443/callback"],
  ["query", "https://client.example/callback?next=https://other.example&csp=;script-src%20*"],
  ["wildcard", "https://*.example/callback"],
  ["punctuation", "https://client.example;script-src/callback"],
  ["opaque", "custom-client:/callback"],
]);
const app = express();
app.use(securityHeaders);
app.get("/approval/:fixture", (req, res) => {
  const callback = callbacks.get(req.params.fixture);
  assert.ok(callback);
  allowOAuthCallback(res, callback);
  res.type("html").send('<form method="post" action="/consent"><button>Authorize</button></form>');
});
app.get("/login", (_req, res) => res.type("html").send('<form method="post" action="/login"></form>'));
app.post("/consent", (_req, res) => res.redirect(302, callbacks.get("external")!));

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function policy(path: string, method = "GET"): Promise<string> {
  const response = await fetch(base + path, { method, redirect: "manual" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const csp = response.headers.get("content-security-policy");
  assert.ok(csp);
  // Every directive except form-action must remain byte-for-byte identical.
  assert.deepEqual(csp.split("; ").filter(value => !value.startsWith("form-action ")),
    DEFAULT_CONTENT_SECURITY_POLICY.split("; ").filter(value => !value.startsWith("form-action ")));
  await response.text();
  return csp;
}
try {
  for (const [fixture, expectedOrigin] of [
    ["loopback", "http://localhost:48731"],
    ["loopback-ip", "http://127.0.0.1:49217"],
    ["external", "https://chatgpt.com"],
    ["external-port", "https://client.example:8443"],
    ["query", "https://client.example"],
  ]) {
    assert.equal(await policy(`/approval/${fixture}`), DEFAULT_CONTENT_SECURITY_POLICY.replace(
      "form-action 'self'", `form-action 'self' ${expectedOrigin}`,
    ));
  }
  for (const fixture of ["wildcard", "punctuation", "opaque"]) {
    assert.equal(await policy(`/approval/${fixture}`), DEFAULT_CONTENT_SECURITY_POLICY);
  }
  // An approval must not change the global policy or the redirect response.
  assert.equal(await policy("/login"), DEFAULT_CONTENT_SECURITY_POLICY);
  assert.equal(await policy("/consent", "POST"), DEFAULT_CONTENT_SECURITY_POLICY);
  console.log("OAuth policy checks passed: approval-only callback origins, exact loopback ports, injection rejection, unchanged global security headers.");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
