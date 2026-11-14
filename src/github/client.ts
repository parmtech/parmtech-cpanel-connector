export type GitHubMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const ORIGIN = "https://api.github.com";

export function githubUrl(path: string, query: Record<string, string | number | boolean> = {}): URL {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020\u007f#]/.test(path)) throw Error("Use a GitHub API path starting with one slash.");
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || url.username || url.password) throw Error("Only api.github.com is supported.");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url;
}

export class GitHubApiError extends Error {
  constructor(readonly status: number, readonly detail: unknown, readonly remaining: string | null, readonly retryAfter: string | null) {
    super(`GitHub returned HTTP ${status}. Check the account permissions, organization policies, and API rate limits.`);
  }
}

export class GitHubClient {
  constructor(private readonly token: string, private readonly transport: typeof fetch = fetch) {}
  async request(method: GitHubMethod, path: string, query: Record<string, string | number | boolean> = {}, body?: unknown) {
    const response = await this.transport(githubUrl(path, query), {
      method, redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "PARMTECH-GitHub-Connector/0.1.0", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const limit = 3 * 1024 * 1024;
    if (Number(response.headers.get("content-length") ?? 0) > limit) { await response.body?.cancel(); throw Error("GitHub response is too large. Request a smaller page or individual file."); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      if (reader) while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > limit) { await reader.cancel(); throw Error("GitHub response exceeds the response limit. Use pagination."); } chunks.push(next.value); }
    } finally { reader?.releaseLock(); }
    const raw = Buffer.concat(chunks).toString("utf8");
    let data: unknown = null;
    if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
    // Never echo the credential, including if an upstream error reflects input.
    const scrubbed = raw.includes(this.token) ? JSON.parse(JSON.stringify(data).split(this.token).join("[REDACTED]")) : data;
    if (!response.ok) throw new GitHubApiError(response.status, scrubbed, response.headers.get("x-ratelimit-remaining"), response.headers.get("retry-after"));
    return { status: response.status, data: scrubbed, grantedScopes: response.headers.get("x-oauth-scopes")?.split(",").map(s => s.trim()).filter(Boolean) ?? [], nextPage: response.headers.get("link"), rateLimitRemaining: response.headers.get("x-ratelimit-remaining") };
  }
}
