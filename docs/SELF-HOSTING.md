# Your own cPanel connector

Run the connector on infrastructure you control, with **your own cPanel host, username and API token**. Your connector talks directly to your hosting server; you do not need an account on, or requests to, PARMTECH's owner-restricted hosted connector. The source code is MIT licensed. This is **alpha software**, so use a dedicated token, start with read-only operations, and review the limitations below.

## Choose your route

| | Local prototype | Self-hosted OAuth server |
|---|---|---|
| Best for | A compatible local MCP client on your computer | A compatible remote MCP client, including supported ChatGPT configurations |
| Runs on | Your computer, while the client runs | Your server, independently of your computer |
| Requires | Node.js 22.19+ and an OS credential store | Docker Compose, a public HTTPS domain and reverse proxy, PostgreSQL volume, working SMTP |
| Hosting access | cPanel API token; no WHM | cPanel or WHM; token recommended |
| Security | Local credential store; loopback HTTP has no OAuth and must not be exposed | Connector login, OAuth and encrypted stored profiles; the server operator can decrypt them |

The two installations do not share saved accounts. The local HTTP/tunnel experiment is not a public OAuth server. Client support and availability vary; a public listing is not implied.

## Before you begin

1. In **your own cPanel**, find **Security → Manage API Tokens** and create a dedicated token. Record its value in a password manager; cPanel may show it only once. Your host's interface or policy may differ. Use permissions appropriate to the task.
2. Note your cPanel server hostname (for example `server.yourhost.com`, without a `/cpsess...` path), cPanel username, and token name. cPanel uses HTTPS port 2083. Your host must allow the API connection and its TLS certificate must be valid.
3. Never put tokens, passwords, verification codes, database credentials, encryption keys, or private configuration in an AI chat, issue, command line, screenshot, or Git repository. Enter the hosting token only in the local hidden prompt or your own connector's HTTPS form. Treat access to your connector server and backups as access to its saved credentials.

## Option A: run locally

1. Install Git and Node.js **22.19 or newer**, including npm. In a terminal:

   ```sh
   git clone https://github.com/parmtech/parmtech-cpanel-connector.git
   cd parmtech-cpanel-connector
   npm ci
   npm run build
   npm run setup
   ```

2. In the interactive terminal enter the label, host, username and optional token name. Type or paste the token at the **hidden** prompt. The connector validates it and saves it in the operating system credential store. A working OS keyring is required; on Linux this may require an unlocked Secret Service session. On Windows, after building, `Setup cPanel Connection.cmd` offers a loopback browser form instead.
3. For a local Codex installation, from the same directory run:

   ```sh
   codex mcp add my_cpanel -- node "$(pwd)/dist/src/index.js"
   ```

   This command is for macOS/Linux shells; use an absolute path to `dist/src/index.js` with your client on Windows. Run the client as the same OS user with access to the credential store. Restart the client if needed. Ask it to list connected accounts and then domains. Client setup and availability can change.
4. List or remove local profiles with `npm run setup -- list` and `npm run setup -- disconnect`. Removing a profile locally does not necessarily revoke the token; revoke it in cPanel as well, or use the optional remote revoke when supported.

Do not forward or expose the loopback endpoint to the internet. The local connector runs when your client starts it and does not provide a remote OAuth login.

## Option B: host your own remote connector

These steps assume a Linux server with Git, Docker Compose, a TLS reverse proxy, a DNS name pointing to the server, and an SMTP account. You must control the server, DNS and proxy. Shared cPanel plans may not permit Docker: see the [cPanel/Passenger instructions](COMPLETE-GUIDE.md#8-install-on-cpanel-hosting) if your provider supports Node.js 22.19+, Passenger and PostgreSQL.

1. Clone the source on your server and create a private configuration:

   ```sh
   git clone https://github.com/parmtech/parmtech-cpanel-connector.git
   cd parmtech-cpanel-connector
   umask 077
   cp .env.example .env
   chmod 600 .env
   ```

2. Edit `.env` in a private editor on the server. Set:

   - `PUBLIC_BASE_URL` to your HTTPS origin, for example `https://connector.your-domain.com`, with no path or trailing `/mcp`.
   - `COMPANY_SITE_URL` to an HTTPS website you control; the root redirects there. The example otherwise points to PARMTECH.
   - `SETUP_OWNER_EMAIL` and `REGISTRATION_ALLOWED_EMAILS` to your own email address. Keep the allowlist restricted for a private installation.
   - `POSTGRES_PASSWORD` to a long unique random password. Use a value compatible with Compose `.env` syntax; avoid unescaped `$` and `#`.
   - `CREDENTIAL_ENCRYPTION_KEY` to a unique 32-byte base64 key. Generate one locally with `openssl rand -base64 32` and enter it in the private file. Do not share its output. Keep it stable across restarts.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` for your mail provider. Docker normally needs SMTP; match its TLS settings. Quote or escape special characters according to Docker Compose `.env` syntax.
   - Set `TRUST_PROXY=true` only if the app is reached through a trusted reverse proxy that overwrites forwarded headers. Otherwise leave it `false`.

   Back up the encryption key and database separately and securely. Losing the original key makes existing stored profiles unreadable; key rotation is not yet provided. Do not commit or upload `.env`.
3. Configure your reverse proxy to terminate HTTPS for your own domain and forward requests to `127.0.0.1:3210`. Ensure DNS, certificate renewal, Web/HTTP streaming, and forwarded headers work. Do not publish the PostgreSQL port, log request bodies or authorization headers, or expose port 3210 publicly. Restrict outbound traffic to legitimate public hosting servers where practical. The Compose file binds the application to loopback and keeps PostgreSQL on its private network.
4. Start your own services:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

   The named PostgreSQL volume holds persistent data. Avoid `docker compose down -v`: it deletes that volume. Back up and test restoration of the database and original key.
5. In a browser visit `https://connector.your-domain.com/health` and `https://connector.your-domain.com/.well-known/oauth-authorization-server`. You should see JSON. Then open `https://connector.your-domain.com/mani_admin`, enter the configured owner email, and use the emailed code in the same browser to create a new connector password. There is no default password. Email delivery must work first.
6. In your connector's HTTPS settings, add a hosting profile using your cPanel hostname, username, API token and optional token name. The connector validates the credentials before saving. Never enter them in a chat. Use WHM only if deliberately needed: WHM permissions can affect multiple accounts or the server.
7. Add `https://connector.your-domain.com/mcp` to a compatible remote MCP client using OAuth, sign in to **your own** connector, and review its permissions. For Codex, replace the example domain in:

   ```sh
   codex mcp add my_cpanel_remote --url https://connector.your-domain.com/mcp
   ```

   Follow the browser login if offered; otherwise use `codex mcp login my_cpanel_remote`. For ChatGPT, use its supported custom MCP flow if available to your account. `/mcp` is a protocol endpoint, not the login page. Start by asking to list connected accounts and domains; grant write scopes only when needed.

## Troubleshooting and limits

- **Setup email missing:** check the owner address, SMTP settings, spam folder and private mail logs. Never share log lines containing secrets.
- **Hosting validation fails:** check the actual cPanel hostname, username, token permissions, valid TLS and outbound access to port 2083. The hosted server rejects private and loopback hosting addresses; a private-only cPanel server is not supported by that mode.
- **OAuth or proxy fails:** check that the public URL matches `PUBLIC_BASE_URL`, HTTPS works, proxy headers are trusted only as described, and the client supports remote MCP with OAuth. Open `/mani_admin` for login; opening `/mcp` directly is not a complete test.
- **Local keyring fails:** unlock/configure your OS credential store and run setup and client as the same user.
- **Disconnected account:** removing a saved profile is separate from revoking its token at your hosting provider. Revoke compromised or unused tokens in cPanel.

This alpha uses process-local rate limits: run one app instance. Automated password recovery and encryption-key rotation are not provided. Before offering it to other users, conduct a security review and add appropriate recovery, monitoring, backup/restore, abuse controls and privacy/support arrangements. Real hosting access and email delivery depend on your provider. See the [complete guide](COMPLETE-GUIDE.md) and [security policy](../SECURITY.md).

## Copyable prompt for your AI assistant

Copy the following, then provide only non-secret details when asked:

```text
Help me set up my own copy of https://github.com/parmtech/parmtech-cpanel-connector using its docs/SELF-HOSTING.md. First help me choose between the local cPanel prototype and the self-hosted OAuth server based on my operating system, client, and infrastructure. Inspect the current repository and check prerequisites before suggesting commands. I want to use my own cPanel host, username and API token, and my own server if I choose remote hosting; do not use the PARMTECH hosted endpoint. Guide me one step at a time, explain changes before making them, and test what can safely be tested. Never ask me to paste a token, password, verification code, encryption key, private configuration, or other secret into chat. Tell me where to enter secrets privately instead. Start with read-only verification, explain alpha limitations and ask before any destructive hosting change.
```
