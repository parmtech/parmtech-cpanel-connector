import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { PlayClient } from "../src/play/client.js";
import { parsePlayServiceAccount } from "../src/play/routes.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = { type: "service_account", client_email: "test@sample-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token", project_id: "sample-project" };
assert.equal(parsePlayServiceAccount(JSON.stringify(credentials)).client_email, credentials.client_email);
assert.throws(() => parsePlayServiceAccount(JSON.stringify({ ...credentials, token_uri: "https://example.com/token" })));
assert.throws(() => parsePlayServiceAccount(JSON.stringify({ ...credentials, private_key: "invalid" })));

const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  requests.push(url);
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(String(init?.body));
    const jwt = form.get("assertion")!;
    const [header, payload, signature] = jwt.split(".");
    assert.ok(header && payload && signature);
    const verify = createVerify("RSA-SHA256"); verify.update(`${header}.${payload}`); verify.end();
    assert.ok(verify.verify(publicKey, Buffer.from(signature, "base64url")));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
    assert.equal(claims.aud, url);
    return Response.json({ access_token: "test-token", expires_in: 3600 });
  }
  assert.equal(url, "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/au.parmtech.radio/reviews?maxResults=1");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
  return Response.json({ reviews: [] });
};
try {
  const client = new PlayClient(parsePlayServiceAccount(JSON.stringify(credentials)));
  await assert.rejects(client.request("GET", "https://evil.example/androidpublisher/v3/applications/au.parmtech.radio/reviews"));
  await assert.rejects(client.request("GET", "/androidpublisher/v3/applications/../reviews"));
  assert.deepEqual(await client.request("GET", "/androidpublisher/v3/applications/au.parmtech.radio/reviews", { maxResults: 1 }), { reviews: [] });
  assert.equal(requests.length, 2);
} finally { globalThis.fetch = originalFetch; }
console.log("Play Console credential validation, Google token exchange, and API boundary passed.");
