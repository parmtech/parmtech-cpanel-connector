import type { AccountCredentials, UapiEnvelope, UapiParameters } from "./types.js";
import { validateUapiPath } from "./host.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_INLINE_UPLOAD_BYTES = 500_000;
let activeUploads = 0;

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

  async callApi2(credentials: AccountCredentials, moduleName: string, functionName: string, parameters: UapiParameters = {}): Promise<unknown> {
    validateUapiPath(moduleName, functionName);
    if (credentials.kind === "whm") throw new Error("cPanel API 2 requires a cPanel-level connection.");
    const secret = credentials.authType === "password" ? credentials.password : credentials.apiToken;
    if (!secret) throw new Error("The saved cPanel credential is incomplete.");
    const auth = credentials.authType === "password" ? `Basic ${Buffer.from(`${credentials.username}:${secret}`).toString("base64")}` : `cpanel ${credentials.username}:${secret}`;
    const body = new URLSearchParams({ cpanel_jsonapi_user: credentials.username, cpanel_jsonapi_apiversion: "2", cpanel_jsonapi_module: moduleName, cpanel_jsonapi_func: functionName });
    for (const [key, value] of Object.entries(parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) throw new Error(`Invalid API 2 parameter name: ${key}`);
      if (value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) body.append(key, String(item));
    }
    const response = await this.fetchImpl(new URL("/json-api/cpanel", credentials.host), { method: "POST", headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "error", signal: AbortSignal.timeout(30_000) });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error("cPanel API 2 returned more than 1 MB of data.");
    if (!response.ok) throw new Error(`cPanel API 2 returned HTTP ${response.status}.`);
    let payload: { cpanelresult?: { event?: { result?: number }; data?: Array<{ result?: number; err?: string }>; error?: string } };
    try { payload = JSON.parse(raw); } catch { throw new Error("cPanel API 2 returned invalid JSON."); }
    const result = payload.cpanelresult;
    if (!result || result.error || result.event?.result !== 1 || result.data?.some(item => item.result === 0 || item.err)) throw new Error("cPanel API 2 reported a failure.");
    const parameterSecrets = Object.entries(parameters).filter(([key]) => /password|token|secret|credential|authorization|private[_-]?key|access[_-]?key/i.test(key)).flatMap(([, value]) => value == null ? [] : Array.isArray(value) ? value : [value]).map(String);
    return redactSecrets(result, [credentials.apiToken ?? "", credentials.password ?? "", ...parameterSecrets]);
  }

  async uploadFile(credentials: AccountCredentials, directory: string, filename: string, source: { contentBase64?: string; sourceUrl?: string }): Promise<{ uploaded: true; directory: string; filename: string; bytes: number }> {
    if (credentials.kind === "whm") throw new Error("File upload requires a cPanel-level connection.");
    if (!directory || /[\r\n\0]/.test(directory) || directory.length > 1024) throw new Error("Enter a valid destination directory.");
    if (!filename || filename === "." || filename === ".." || /[\\/\r\n\0\";]/.test(filename) || filename.length > 255) throw new Error("Enter a filename without a path.");
    if (Boolean(source.contentBase64) === Boolean(source.sourceUrl)) throw new Error("Provide exactly one file source: base64 content or a public HTTPS URL.");
    if (activeUploads) throw new Error("Another file upload is already running. Try again after it finishes.");
    activeUploads++;
    try {
    let bytes: Uint8Array;
    if (source.contentBase64) {
      const encoded = source.contentBase64;
      if (encoded.length > Math.ceil(MAX_INLINE_UPLOAD_BYTES / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Inline file content must be valid base64 and at most 500 KB.");
      bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > MAX_INLINE_UPLOAD_BYTES) throw new Error("Inline file content must be between 1 byte and 500 KB.");
    } else {
      let url: URL;
      try { url = new URL(source.sourceUrl!); } catch { throw new Error("Enter a valid public HTTPS source URL."); }
      if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.search || url.hash) throw new Error("Use a direct public HTTPS file URL without credentials or query parameters.");
      const response = await this.fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !response.body) throw new Error("The public source file could not be downloaded.");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_UPLOAD_BYTES) { await response.body.cancel(); throw new Error("The source file exceeds the 32 MB upload limit."); }
      const chunks: Buffer[] = []; let total = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > MAX_UPLOAD_BYTES) throw new Error("The source file exceeds the 32 MB upload limit.");
          chunks.push(Buffer.from(part.value));
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      if (!total) throw new Error("The source file is empty.");
      bytes = Buffer.concat(chunks, total);
    }
    const secret = credentials.authType === "password" ? credentials.password : credentials.apiToken;
    if (!secret) throw new Error("The saved cPanel credential is incomplete.");
    const auth = credentials.authType === "password" ? `Basic ${Buffer.from(`${credentials.username}:${secret}`).toString("base64")}` : `cpanel ${credentials.username}:${secret}`;
    const form = new FormData();
    form.append("dir", directory);
    form.append("file-1", new Blob([Buffer.from(bytes)], { type: "application/octet-stream" }), filename);
    const endpoint = new URL("/execute/Fileman/upload_files", credentials.host);
    const response = await this.fetchImpl(endpoint, { method: "POST", headers: { Authorization: auth, Accept: "application/json", "User-Agent": "PARMTECH-cPanel-Connector/0.2.0-alpha.3" }, body: form, signal: AbortSignal.timeout(120_000), redirect: "error" });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("cPanel returned a response larger than the 1 MB safety limit.");
    if (!response.ok) throw new Error(`cPanel upload returned HTTP ${response.status}.`);
    let parsed: UapiEnvelope;
    try { parsed = JSON.parse(body) as UapiEnvelope; } catch { throw new Error("cPanel upload returned invalid JSON."); }
    const result = parsed.result ?? (parsed as UapiEnvelope["result"]);
    const uploads = (result?.data as { uploads?: Array<{ status?: number }> } | undefined)?.uploads;
    if (result?.status !== 1 || (Array.isArray(result.errors) && result.errors.length > 0) || uploads?.some(file => file.status === 0)) throw new Error("cPanel did not confirm the file upload.");
    return { uploaded: true, directory, filename, bytes: bytes.byteLength };
    } finally { activeUploads--; }
  }

  async uploadStagedFile(credentials: AccountCredentials, directory: string, filename: string, file: Blob): Promise<{ uploaded: true; directory: string; filename: string; bytes: number }> {
    if (credentials.kind === "whm") throw new Error("File upload requires a cPanel-level connection.");
    if (!directory || /[\r\n\0]/.test(directory) || directory.length > 1024) throw new Error("Enter a valid destination directory.");
    if (!filename || filename === "." || filename === ".." || /[\\/\r\n\0\";]/.test(filename) || filename.length > 255) throw new Error("Enter a filename without a path.");
    if (file.size < 1 || file.size > 128 * 1024 * 1024) throw new Error("Staged file must be between 1 byte and 128 MB.");
    if (activeUploads) throw new Error("Another file upload is already running. Try again after it finishes.");
    activeUploads++;
    try {
      const secret = credentials.authType === "password" ? credentials.password : credentials.apiToken;
      if (!secret) throw new Error("The saved cPanel credential is incomplete.");
      const auth = credentials.authType === "password" ? `Basic ${Buffer.from(`${credentials.username}:${secret}`).toString("base64")}` : `cpanel ${credentials.username}:${secret}`;
      const form = new FormData();
      form.append("dir", directory);
      form.append("file-1", file, filename);
      const endpoint = new URL("/execute/Fileman/upload_files", credentials.host);
      const response = await this.fetchImpl(endpoint, { method: "POST", headers: { Authorization: auth, Accept: "application/json", "User-Agent": "PARMTECH-cPanel-Connector/0.2.0-alpha.3" }, body: form, signal: AbortSignal.timeout(300_000), redirect: "error" });
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("cPanel returned a response larger than the 1 MB safety limit.");
      if (!response.ok) throw new Error(`cPanel upload returned HTTP ${response.status}.`);
      let parsed: UapiEnvelope;
      try { parsed = JSON.parse(body) as UapiEnvelope; } catch { throw new Error("cPanel upload returned invalid JSON."); }
      const result = parsed.result ?? (parsed as UapiEnvelope["result"]);
      const uploads = (result?.data as { uploads?: Array<{ status?: number }> } | undefined)?.uploads;
      if (result?.status !== 1 || (Array.isArray(result.errors) && result.errors.length > 0) || uploads?.some(item => item.status === 0)) throw new Error("cPanel did not confirm the file upload.");
      return { uploaded: true, directory, filename, bytes: file.size };
    } finally { activeUploads--; }
  }

  async call(
    credentials: AccountCredentials,
    moduleName: string,
    functionName: string,
    parameters: UapiParameters = {},
    method: "GET" | "POST" = "GET",
  ): Promise<UapiEnvelope> {
    validateUapiPath(moduleName, functionName);
    if (credentials.kind === "whm") throw new Error("UAPI calls require a cPanel-level connection; use the WHM API tool for server-level connections.");
    const endpoint = new URL(`/execute/${moduleName}/${functionName}`, credentials.host);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
        throw new Error(`Invalid UAPI parameter name: ${key}`);
      }
      if (value === null || value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) (method === "GET" ? endpoint.searchParams : form).append(key, String(item));
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
        method,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          "User-Agent": "PARMTECH-cPanel-Connector/0.2.0-alpha.3",
        },
        ...(method === "POST" ? { body: form } : {}),
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
