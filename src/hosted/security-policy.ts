import type { RequestHandler, Response } from "express";

export const DEFAULT_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", DEFAULT_CONTENT_SECURITY_POLICY);
  next();
};

/** Use only on the consent document, with the SDK-validated, stored transaction URI. */
export function allowOAuthCallback(res: Response, redirectUri: string): void {
  const callbackOrigin = new URL(redirectUri).origin;
  // URL parsing alone permits some hostname punctuation with meaning in CSP.
  // Allow one concrete HTTP(S) origin, never a wildcard, scheme source, or directive.
  if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(callbackOrigin)) return;
  // Chromium checks the initiating document's form-action on every redirect.
  // Changing the POST response's CSP or using 303 cannot authorize the callback.
  res.setHeader("Content-Security-Policy", DEFAULT_CONTENT_SECURITY_POLICY.replace(
    "form-action 'self'", `form-action 'self' ${callbackOrigin}`,
  ));
}
