import type { AccountCredentials, UapiParameters } from "./types.js";
import type { FetchLike } from "./uapi.js";

const TIMEOUT_MS = 30_000;
export const WHM_READ_ONLY_FUNCTIONS = new Set(["version", "gethostname", "loadavg", "listaccts", "accountsummary", "listresellers", "listzones", "listpkgs", "listservices", "servicestatus"]);

export class WhmClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async readOnly(credentials: AccountCredentials, functionName: string, parameters: UapiParameters = {}): Promise<unknown> {
    if (!WHM_READ_ONLY_FUNCTIONS.has(functionName.toLowerCase())) throw new Error("This WHM API function is not in the read-only allowlist. Use whm_api_execute with explicit whm:write authorization if a server change is intended.");
    return this.call(credentials, functionName, parameters);
  }

  async call(credentials: AccountCredentials, functionName: string, parameters: UapiParameters = {}): Promise<unknown> {
    if (credentials.kind !== "whm") throw new Error("This operation requires a WHM-level connection.");
    if (!/^[a-z][a-z\d_]*$/i.test(functionName)) throw new Error("WHM API function name is invalid.");
    const secret = credentials.authType === "password" ? credentials.password : credentials.apiToken;
    if (!secret) throw new Error("The saved WHM credential is incomplete.");
    const endpoint = new URL(`/json-api/${functionName}`, credentials.host);
    endpoint.searchParams.set("api.version", "1");
    for (const [key, value] of Object.entries(parameters)) {
      if (!/^[a-z][a-z\d_.-]*$/i.test(key)) throw new Error(`Invalid WHM API parameter name: ${key}`);
      if (value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) endpoint.searchParams.append(key, String(item));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Authorization: credentials.authType === "password"
            ? `Basic ${Buffer.from(`${credentials.username}:${secret}`).toString("base64")}`
            : `whm ${credentials.username}:${secret}`,
          Accept: "application/json",
          "User-Agent": "PARMTECH-cPanel-Connector/0.2.0",
        },
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 1_000_000) throw new Error("WHM returned a response larger than the 1 MB limit.");
      if (!response.ok) throw new Error(`WHM returned HTTP ${response.status}. Check the host, username, credential, and API permissions.`);
      let result: unknown;
      try { result = JSON.parse(raw); } catch { throw new Error("WHM returned a non-JSON response."); }
      if (result && typeof result === "object" && "metadata" in result) {
        const metadata = (result as { metadata?: { result?: unknown } }).metadata;
        if (metadata?.result === 0 || metadata?.result === false) throw new Error("WHM API reported a failure. Check the connection permissions and requested function.");
      }
      const parameterSecrets = Object.entries(parameters)
        .filter(([key]) => /password|token|secret|credential|authorization|private[_-]?key|access[_-]?key/i.test(key))
        .flatMap(([, value]) => value == null ? [] : Array.isArray(value) ? value : [value])
        .map(String);
      return redact(result, [secret, ...parameterSecrets]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("WHM request timed out after 30 seconds.");
      if (error instanceof Error && /^(WHM returned|WHM request|WHM API reported|Invalid WHM)/.test(error.message)) throw error;
      throw new Error("Could not connect to the WHM API over HTTPS. Check that port 2087 is reachable.");
    } finally { clearTimeout(timeout); }
  }
}

function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((safe, secret) => safe.split(secret).join("[REDACTED]"), value);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|token|secret|credential|authorization|access[_-]?hash/i.test(key) ? "[REDACTED]" : redact(item, secrets)]));
  }
  return value;
}
