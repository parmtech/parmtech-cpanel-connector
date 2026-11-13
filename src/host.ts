import { isIP } from "node:net";

export function normalizeCpanelHost(rawHost: string): string {
  const input = rawHost.trim();
  if (!input || /[\s@]/.test(input)) {
    throw new Error("Enter the cPanel server host name or IP address.");
  }

  const source = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("The cPanel host is not a valid host name or IP address.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Use the cPanel server address only (HTTPS host and optional port, without a path or login details).");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) === 0 && !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(host)) {
    throw new Error("The cPanel host is not a valid DNS name or IP address.");
  }

  const port = url.port ? `:${url.port}` : ":2083";
  const bracketedHost = host.includes(":") ? `[${host}]` : host;
  return `https://${bracketedHost}${port}`;
}

export function validateCpanelUsername(username: string): string {
  const normalized = username.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$/.test(normalized)) {
    throw new Error("Enter the cPanel account username (up to 32 letters, numbers, dots, underscores, or hyphens).");
  }
  return normalized;
}

export function validateUapiPath(moduleName: string, functionName: string): void {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(moduleName)) {
    throw new Error("UAPI module must contain only letters and numbers.");
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(functionName)) {
    throw new Error("UAPI function must contain only letters, numbers, and underscores.");
  }
}
