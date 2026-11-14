import { createSign } from "node:crypto";

export type PlayServiceAccount = { client_email: string; private_key: string; token_uri: string; project_id?: string };

const audience = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/androidpublisher";

export class PlayClient {
  private token?: { value: string; expiresAt: number };
  constructor(private readonly account: PlayServiceAccount) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: this.account.client_email, scope, aud: audience, iat: now, exp: now + 3600 })}`;
    const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
    const assertion = `${unsigned}.${signer.sign(this.account.private_key).toString("base64url")}`;
    const response = await fetch(audience, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!response.ok || !result.access_token) throw Error("Google did not authorize this service account. Check the Play Console invitation and API setup.");
    this.token = { value: result.access_token, expiresAt: Date.now() + Math.min(result.expires_in ?? 3600, 3600) * 1000 };
    return result.access_token;
  }

  async request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, query: Record<string, string | number | boolean> = {}, body?: unknown) {
    if (!/^\/androidpublisher\/v3\/(applications\/[A-Za-z0-9_.]+(?:\/.*)?|developers\/\d+(?:\/.*)?)$/.test(path) || path.includes("..") || path.includes("//") || path.includes("?")) throw Error("Only a Google Play Developer API path is accepted.");
    const url = new URL(path, "https://androidpublisher.googleapis.com");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetch(url, { method, redirect: "error", headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const raw = await response.text();
    let data: unknown; try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw.slice(0, 500) }; }
    if (!response.ok) throw Error(`Google Play request failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
    return data;
  }
}
