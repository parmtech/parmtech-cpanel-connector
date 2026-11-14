# PARMTECH cPanel Connector

**Owner-restricted hosted alpha deployed, 13 November 2026.** The HTTPS service is at `https://connector.parmtech.au/mcp` on the owner's Namecheap cPanel hosting. Health, OAuth metadata, client registration, PKCE sign-in forms, unauthorized-request rejection and a managed restart were checked live. Completing the owner's browser authorization is still required before claiming an authenticated hosting-tool call from the new client. This is not a public multi-user release.

The hosted service runs under CloudLinux/Passenger and uses its own PostgreSQL database. It does not require the Windows PC to stay on. Passenger can idle/restart the process; persistent credentials and OAuth data live outside the process. Hosting availability and token revocation still apply. See [cPanel deployment and recovery](deploy/cpanel/README.md).

PARMTECH is an independent digital engineering studio. cPanel® and WHM® are third-party products and trademarks.

Source repository: https://github.com/parmtech/parmtech-cpanel-connector (alpha source; not public hosted-service approval).

## Start here

Open [the standalone guide](docs/START-HERE.html), read [the complete guide](docs/COMPLETE-GUIDE.md), or use [the quickstart](docs/QUICKSTART.md). First-time owner setup and later login are at `/mani_admin`. The connector hostname's root redirects to the configured official website. No default/shared administrator password is supplied.

For a new deployment, configure the trusted owner email, database, mail and stable encryption key once. The first browser setup verifies that mailbox before creating the administrator. The source package is MIT-licensed; actual hosting secrets and local operational state are not part of the distribution. The PARMTECH endpoint remains owner-restricted, and no public ChatGPT directory approval is claimed.

## ChatGPT support

Use a client that supports remote MCP with OAuth. Client/account availability is governed by the client platform; check its current connection documentation. Installing the old local plugin does not automatically switch it to the hosted service. The owner's Codex configuration now has a separate `parmtech_hosted` remote entry; browser sign-in is required once to authorize it.

### Google Play Console connector

The separate Play Console MCP resource is `https://connector.parmtech.au/play/mcp`. It uses the same PARMTECH administrator login, with its own Play read/write grants. Its Google credential is stored encrypted and is never returned by an MCP tool.

To connect: enable the [Google Play Developer API](https://developers.google.com/android-publisher/getting_started) in a Google Cloud project, create a service account, and invite that service account email in Play Console **Users and permissions** with only the app rights required. Save its JSON key at `/mani_admin/play` over HTTPS. Then add the Play MCP URL as a separate ChatGPT custom connection and approve its scopes. Use `play_connection_status` to verify Google token issuance and `play_check_app` with a real package name to verify Play Console access. The key can be removed from the same settings page. Never paste it into a chat or commit it to GitHub.

The connector can read app data and make supported JSON Play Developer API changes, including edits, tracks, listings and reviews. The current MCP interface **does not upload binary AAB/APK files**, create a new Play app, or complete legal declarations. Use Play Console for a new app's first setup, and use a separate build/release pipeline for a bundle upload. A saved key and a successful Google token request alone do not prove permission for a particular app; `play_check_app` must pass before claiming that.

## Connection and authorization flow

1. A user adds the hosted HTTPS MCP URL in ChatGPT and starts OAuth.
2. PARMTECH verifies the OAuth client registration and PKCE authorization request, then opens a hosted profile page.
3. On the first installation the owner completes the verified administrator wizard at `/mani_admin`. Subsequently the user signs in (or creates an ordinary profile if registration is enabled), then enters hosting credentials into a password-masked HTTPS form. This page is separate from the ChatGPT conversation and connector settings; the connector does not inject arbitrary fields into ChatGPT settings.
4. PARMTECH validates the credentials against cPanel or WHM before encrypting and saving them. Users can label and manage multiple profiles from the hosted settings page.
5. The user approves OAuth scopes. Every MCP call checks the bearer token, expiry, tenant, canonical resource, and required scope. Account IDs are stable opaque IDs scoped to that signed-in profile.

The service uses its own email/password identity with SMTP email verification. The server operator controls the encryption key and therefore has technical access to decrypt stored credentials. Do not promise operator-blind storage.

## Supported credential types

| Access level | Authentication | API route | Permission scope |
| --- | --- | --- | --- |
| cPanel account | cPanel API token | UAPI over HTTPS on port 2083 | cPanel account permissions |
| cPanel account | cPanel username and password | UAPI over HTTPS on port 2083 | cPanel account permissions and server policy |
| WHM server | WHM API token | WHM API 1 over HTTPS on port 2087 | WHM role and token ACLs; can affect multiple accounts or the server |
| WHM server | WHM username and password | WHM API 1 over HTTPS on port 2087 | WHM role and server policy |

Deprecated WHM access-hash authentication is not supported. cPanel and WHM are separate connection types. API permissions, host configuration, and any enabled two-factor policy determine which requests the server accepts.

## MCP tools

- `cpanel_list_accounts` returns each profile's stable ID, label, host, username, and cPanel/WHM access level. Secrets are never returned.
- `cpanel_list_domains`, `cpanel_list_email_accounts`, and `cpanel_list_files` read cPanel account data.
- `cpanel_create_email_account` and `cpanel_delete_email_account` change cPanel mailboxes.
- `cpanel_uapi_execute` exposes broad UAPI access and requires the `cpanel:write` grant.
- `whm_api_read` offers an explicit read-only allowlist for common WHM API 1 functions.
- `whm_api_execute` exposes broad WHM API 1 access and requires the `whm:write` grant. It can affect multiple accounts or the whole server.
- `hosting_disconnect_connection` removes the encrypted local profile. In hosted settings, a saved token name enables an optional remote revoke through cPanel UAPI or WHM API 1; the hosting account must grant the corresponding token-management permission.

Tool authorization scopes are `accounts:read`, `accounts:write`, `cpanel:read`, `cpanel:write`, `whm:read`, `whm:write`, and `offline_access`. The OAuth server supports public clients using authorization code + PKCE S256, DCR, resource binding, short-lived access tokens, refresh-token rotation, and token revocation. Client credentials and customer-supplied API keys at the MCP auth layer are rejected.

## Self-host deployment package

The deployer needs a stable HTTPS domain, a reverse proxy with TLS, Docker Compose, PostgreSQL storage, and an SMTP account for verified user registration. ChatGPT end users do not need a terminal or local machine setup.

1. Copy `.env.example` to `.env` on the deployment host and set `PUBLIC_BASE_URL`, a unique PostgreSQL password, a 32-byte base64 encryption key, and SMTP values. Generate secrets using the deployment platform's secret manager; for a manual one-time setup, `openssl rand -base64 32` creates an encryption key. Replace the example URL in `mcp.json` with the final HTTPS endpoint before connector registration.
2. Point the public HTTPS reverse proxy to `127.0.0.1:3210`. Keep the database private. Do not enable request-body logging, and restrict outbound network access to public hosting control panels. Set `TRUST_PROXY=true` only when requests pass through a trusted proxy that overwrites forwarded headers.
3. Run `docker compose up -d --build` on the deployment host.
4. Add `https://<your-domain>/mcp` to ChatGPT web. Verify the protected-resource and OAuth metadata endpoints before allowing users to connect.

The app rejects loopback/private host addresses and resolves and pins each outbound API request to a public DNS result, preventing a later DNS change from redirecting a request to a private address. Keep deployment-level egress filtering enabled as defense in depth. PostgreSQL contains AES-GCM-encrypted credentials bound to each user/profile ID and hashed OAuth/session tokens. Protect its volume and the encryption key with the same care as the hosting credentials; back up both independently.

`CREDENTIAL_ENCRYPTION_KEY` must remain stable to decrypt existing profiles. Key rotation needs an explicit re-encryption migration and is not yet provided. This alpha currently uses process-local rate limits, so deploy a single app instance unless shared rate-limit storage is added. Before public multi-user operation, complete a security review, test against dedicated cPanel and WHM accounts, add support/privacy/terms pages, configure production monitoring and backups, and review the hosting provider's data-handling terms.

## Local prototype

The original local cPanel-only prototype remains available for development. It supports Codex stdio and a loopback Secure MCP Tunnel experiment, and requires local Node setup. It is not the hosted multi-user service and should not be exposed publicly. Its existing `outputs/parmtech-cpanel-connector-0.1.0.zip` remains the local prototype archive; it has not been replaced with a hosted bundle.

### Local graphical account setup

On Windows, run `Setup cPanel Connection.cmd` to open the setup page in the default browser. The page listens only on `127.0.0.1`, validates the cPanel API token against UAPI, and stores it in Windows Credential Manager. It does not send the token to ChatGPT or write it into the project files. Keep the command window open while the page is in use, then close it to stop the local setup server. ChatGPT Desktop's local stdio connector can use the saved account independently; the hosted OAuth service still requires its own deployment.
