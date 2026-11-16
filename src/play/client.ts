import { createSign } from "node:crypto";

export type PlayServiceAccount = { client_email: string; private_key: string; token_uri: string; project_id?: string };

const audience = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/androidpublisher";

export class PlayClient {
  private token?: { value: string; expiresAt: number };
  constructor(private readonly account: PlayServiceAccount) {}

  /** Upload media to an existing edit; never assigns a track or commits it. */
  async uploadBundle(packageName: string, editId: string, file: Blob, sha256: string) {
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName) || !/^[A-Za-z0-9_-]{1,200}$/.test(editId)) throw Error("Invalid Play package or edit ID.");
    if (!/^[0-9a-f]{64}$/.test(sha256) || !file.size || file.size > 1_000_000_000) throw Error("Invalid bundle size or SHA-256.");
    const path = `/androidpublisher/v3/applications/${packageName}/edits/${editId}/bundles`;
    // Recover a successful upload whose response/receipt was lost. Never retry POST automatically.
    const existing = await this.request("GET", path) as { bundles?: { versionCode: number; sha256: string }[] };
    const uploaded = existing.bundles?.find(bundle => bundle.sha256?.toLowerCase() === sha256);
    if (uploaded) return uploaded;
    const response = await fetch(`https://androidpublisher.googleapis.com/upload${path}?uploadType=media`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(300_000),
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/octet-stream", "Content-Length": String(file.size), Accept: "application/json" },
      body: file,
    });
    const data = await response.json() as { versionCode?: number; sha256?: string; error?: { message?: string } };
    if (!response.ok) throw Error(`Google Play bundle upload failed (${response.status}). ${String(data.error?.message ?? "Check the edit, signing key and version code.").slice(0, 300)}`);
    if (!Number.isSafeInteger(data.versionCode) || data.sha256?.toLowerCase() !== sha256) throw Error("Google Play bundle receipt did not match the uploaded SHA-256. Check the edit's bundles before retrying.");
    return data;
  }

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
