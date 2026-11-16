import type { Response } from "express";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { HostedRepository } from "./repository.js";
import { createId } from "./crypto.js";

export const OAUTH_SCOPES = ["accounts:read", "accounts:write", "cpanel:read", "cpanel:write", "whm:read", "whm:write", "offline_access"];

export class HostedOAuthProvider implements OAuthServerProvider {
  constructor(private readonly repository: HostedRepository, readonly resource: URL, private readonly baseUrl: URL,
    private readonly policy = { scopes: OAUTH_SCOPES, defaults: ["accounts:read", "cpanel:read", "offline_access"], approvalPath: "/oauth/approve" }) {}
  get clientsStore() { return this.repository; }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!params.resource || params.resource.href.replace(/\/$/, "") !== this.resource.href.replace(/\/$/, "")) throw new InvalidTargetError("OAuth resource does not match this MCP service.");
    const scopes = params.scopes?.length ? params.scopes : this.policy.defaults;
    if (scopes.some((scope) => !this.policy.scopes.includes(scope))) throw new InvalidScopeError("Requested OAuth scope is not supported.");
    const id = createId();
    await this.repository.saveAuthorizationTransaction({ id, userId: "", clientId: client.client_id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, resource: this.resource.href, scopes, ...(params.state ? { state: params.state } : {}) });
    res.redirect(302, new URL(`${this.policy.approvalPath}?tx=${encodeURIComponent(id)}`, this.baseUrl).href);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = await this.repository.findAuthorizationCode(authorizationCode, client.client_id);
    if (!code) throw new InvalidGrantError("Authorization code is invalid or expired.");
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const expectedResource = resource?.href.replace(/\/$/, "");
    if (!redirectUri) throw new InvalidGrantError("OAuth redirect URI is missing.");
    if (!expectedResource || expectedResource !== this.resource.href.replace(/\/$/, "")) throw new InvalidTargetError("OAuth resource does not match this MCP service.");
    const row = await this.repository.consumeAuthorizationCode({ code: authorizationCode, clientId: client.client_id, redirectUri, challenge: (await this.challengeForAuthorizationCode(client, authorizationCode)), resource: this.resource.href });
    if (!row) throw new InvalidGrantError("Authorization code is invalid, expired, or already used.");
    const tokens = await this.repository.createAccessTokens({ clientId: client.client_id, userId: row.userId, resource: this.resource.href, scopes: row.scopes });
    return { access_token: tokens.access, ...(tokens.refresh ? { refresh_token: tokens.refresh } : {}), token_type: "Bearer", expires_in: 3600, scope: row.scopes.join(" ") };
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const existing = await this.repository.findToken(refreshToken, "refresh", client.client_id);
    if (!existing) throw new InvalidGrantError("Refresh token is invalid or expired.");
    if (!resource || resource.href.replace(/\/$/, "") !== this.resource.href.replace(/\/$/, "") || existing.resource.replace(/\/$/, "") !== this.resource.href.replace(/\/$/, "")) throw new InvalidTargetError("OAuth resource does not match this MCP service.");
    if (scopes?.some((scope) => !existing.scopes.includes(scope))) throw new InvalidScopeError("Refresh token cannot increase its granted scopes.");
    const allowed = scopes?.length ? existing.scopes.filter((scope) => scopes.includes(scope)) : existing.scopes;
    if (allowed.some((scope) => !this.policy.scopes.includes(scope))) throw new InvalidScopeError("Requested OAuth scope is not supported.");
    const tokens = await this.repository.rotateRefreshToken(refreshToken, { clientId: client.client_id, userId: existing.userId, resource: this.resource.href, scopes: allowed });
    return { access_token: tokens.access, ...(tokens.refresh ? { refresh_token: tokens.refresh } : {}), token_type: "Bearer", expires_in: 3600, scope: allowed.join(" ") };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const found = await this.repository.findToken(token, "access");
    if (!found || found.resource.replace(/\/$/, "") !== this.resource.href.replace(/\/$/, "")) throw new InvalidTokenError("Access token is invalid or expired.");
    return { token, clientId: found.clientId, scopes: found.scopes, expiresAt: Math.floor(found.expiresAt.getTime() / 1000), resource: this.resource, extra: { userId: found.userId } };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.repository.revokeToken(request.token);
  }
}
