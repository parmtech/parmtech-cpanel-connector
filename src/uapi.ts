import type { AccountCredentials, UapiEnvelope, UapiParameters } from "./types.js";
import { validateUapiPath } from "./host.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function redactSecrets(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((safe, secret) => secret ? safe.split(secret).join("[REDACTED]") : safe, value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = /password|token|secret|credential|authorization|private[_-]?key|access[_-]?key/i.test(key)
        ? "[REDACTED]"
        : redactSecrets(item, secrets);
    }
    return result;
  }
  return value;
}

export class UapiClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async call(
    credentials: AccountCredentials,
    moduleName: string,
    functionName: string,
    parameters: UapiParameters = {},
  ): Promise<UapiEnvelope> {
    validateUapiPath(moduleName, functionName);
    if (credentials.kind === "whm") throw new Error("UAPI calls require a cPanel-level connection; use the WHM API tool for server-level connections.");
    const endpoint = new URL(`/execute/${moduleName}/${functionName}`, credentials.host);
    for (const [key, value] of Object.entries(parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
        throw new Error(`Invalid UAPI parameter name: ${key}`);
      }
      if (value === null || value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) endpoint.searchParams.append(key, String(item));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const secret = credentials.authType === "password" ? credentials.password : credentials.apiToken;
      if (!secret) throw new Error("The saved cPanel credential is incomplete.");
      const auth = credentials.authType === "password"
        ? `Basic ${Buffer.from(`${credentials.username}:${secret}`).toString("base64")}`
        : `cpanel ${credentials.username}:${secret}`;
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Authorization: auth,
          Accept: "application/json",
          "User-Agent": "PARMTECH-cPanel-Connector/0.2.0-alpha.2",
        },
        signal: controller.signal,
        redirect: "error",
      });

      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("cPanel returned a response larger than the 1 MB safety limit.");
      }
      if (!response.ok) {
        throw new Error(`cPanel returned HTTP ${response.status}. Check the host, username, token, and account access.`);
      }

      let parsed: UapiEnvelope;
      try {
        parsed = JSON.parse(body) as UapiEnvelope;
      } catch {
        throw new Error("cPanel returned a response that was not valid JSON.");
      }
      // HTTPS /execute endpoints return the result directly; CLI/proxy callers
      // may wrap it in `result`. Normalize both to the connector's envelope.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !parsed.result && (parsed.status === 0 || parsed.status === 1)) {
        parsed = { apiversion: 3, module: moduleName, func: functionName, result: parsed as NonNullable<UapiEnvelope["result"]> };
      }

      const parameterSecrets = Object.entries(parameters)
        .filter(([key]) => /password|token|secret|credential|authorization|private[_-]?key|access[_-]?key/i.test(key))
        .flatMap(([, value]) => value == null ? [] : Array.isArray(value) ? value : [value])
        .map(String);
      const safe = redactSecrets(parsed, [credentials.apiToken ?? "", credentials.password ?? "", ...parameterSecrets]) as UapiEnvelope;
      if (!safe || typeof safe !== "object" || !safe.result || (safe.result.status !== 0 && safe.result.status !== 1)) {
        throw new Error("cPanel returned an invalid UAPI response. Check that the host points to cPanel on port 2083.");
      }
      if (safe.result?.status === 0) {
        const errors = safe.result.errors;
        const message = Array.isArray(errors) ? errors.join("; ") : typeof errors === "string" ? errors : "UAPI reported a failure.";
        throw new Error(`UAPI reported a failure: ${message}`);
      }
      return safe;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The cPanel request timed out after 30 seconds.");
      }
      if (error instanceof Error && /^(cPanel returned|cPanel request|UAPI reported|Invalid UAPI)/.test(error.message)) throw error;
      throw new Error("Could not connect to the cPanel API over HTTPS. Check the host and that port 2083 is reachable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
