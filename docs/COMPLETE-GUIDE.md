# PARMTECH cPanel Connector — complete setup and user guide

Source version: 0.2.0-alpha.4 · Updated 25 November 2026

## 1. What is in this project?

This connector lets an OAuth-capable MCP client manage user-authorized cPanel UAPI and WHM API1 accounts. It includes a hosted Node.js server, PostgreSQL storage, first-time administrator setup, a private settings portal, OAuth/PKCE, remote plugin manifests, a Windows/local development prototype and deployment tools.

Anyone may self-host this alpha source under its MIT licence using their own infrastructure and credentials. Publishing source does not create a public multi-user hosted service or provide access to another operator’s installation.

The separate `parmtech/cpanel-admin` GitHub repository is an Android Flutter companion. It is not this Node/MCP server, and its APK is not included or silently integrated here.

## 2. Which login is which?

| Login | Purpose | What you enter |
|---|---|---|
| Connector administrator | Manage this connector installation and your saved hosting profiles | Your verified owner email and the new password you create during setup |
| cPanel/WHM hosting profile | Permit hosting API operations | Server hostname, hosting username and API token; password authentication is also supported where permitted by the host |
| ChatGPT/Codex or another MCP client | Authorize that client to use connector tools | Your normal client account plus the connector OAuth consent flow |

There is no built-in shared administrator password. Do not use your email mailbox password, ChatGPT password or cPanel password as an assumed connector password. The first-time wizard creates a new connector login. Passwords are stored as scrypt hashes; saved hosting secrets are encrypted separately.

Use your own address configured in `SETUP_OWNER_EMAIL`. Choose a new connector password during the verification wizard; no password or hosting credential is included in the public source.

## 3. URLs for your own installation

| URL | Behaviour |
|---|---|
| `https://connector.example.com/` | Redirects to the website configured in `COMPANY_SITE_URL` |
| `https://connector.example.com/mani_admin` | First-time setup, then normal connector login/settings |
| `https://connector.example.com/mcp` | Remote MCP endpoint for a client; not a normal web page |
| `https://connector.example.com/health` | Service health response |

There is no separate public marketing frontend on the connector host. OAuth metadata and authorization routes remain reachable because clients need them. Knowing the admin URL does not grant access.

Replace the reserved example hostname with your own connector domain. Use lowercase `/mani_admin` exactly; it contains an underscore, not a space.

## 4. First-time administrator setup

1. Open `/mani_admin` over HTTPS.
2. Enter the owner email configured by the installer in `SETUP_OWNER_EMAIL`.
3. Press **Send verification code**. Read the eight-digit code in that mailbox.
4. Keep the original browser tab open. Enter the code, a new password of 12–256 characters, and its confirmation.
5. Press **Create admin login**. The email is verified and the first administrator is created atomically.
6. Later visits show the normal email/password login instead of first-time setup.

The code expires after 15 minutes, is bound to the requesting browser and permits at most 5 wrong code attempts. At most 3 setup codes per owner email can be requested in 15 minutes. Concurrent setup submissions cannot create two initial administrators. A random first website visitor cannot choose an unrelated mailbox and claim the installation.

The trusted setup email is chosen during server installation, not by an unauthenticated visitor. A self-hoster supplies their own email in the private configuration. If mail delivery is not configured, setup does not create an administrator without verification.

An owner email change after setup does not reset the existing administrator. Do not erase the database to change a password. Automated password-recovery UI is not included in this alpha; recovery requires an authenticated operator procedure and must be completed before a general public hosted launch.

## 5. Add or migrate a hosting connection

After login, use **Add a hosting profile** and fill in:

| Field | Example or meaning |
|---|---|
| Connection label | A friendly name such as `My hosting` |
| Server hostname | `server.yourhost.com`; no cPanel session path such as `/cpsess...` |
| Hosting username | The cPanel or WHM account name, not the connector email |
| Access level | cPanel account or WHM server |
| Credential type | API token, or username/password if the hosting policy permits |
| Secret | Enter only into the masked HTTPS form |
| Token name | Optional descriptive token name; it is not the token value |

cPanel uses HTTPS 2083; WHM uses HTTPS 2087. A hosting provider can restrict API permissions or password authentication. WHM can affect multiple accounts; use it deliberately. The connector validates the credential before saving it. Use dedicated credentials appropriate to the hosting account.

An optional operator-configured migration can import an existing credential for a verified owner. It is disabled in public examples, and no migration credentials or receipts are distributed. Preserve its receipt if you use it so an intentional disconnect is not undone.

## 6. Connect an MCP client

Use **Streamable HTTP with OAuth** at your own `/mcp` URL. The connector supports public-client Dynamic Client Registration, PKCE S256 and resource-bound grants. Start with read-only scopes; `offline_access` permits refresh tokens.

Follow [CLIENT-SETUP.md](CLIENT-SETUP.md) for Codex CLI, IDE/desktop, ChatGPT web/Work, cloud limitations, Claude Code/Desktop, VS Code and Cursor. It includes current official documentation links, platform-specific configuration and a verification record. Local Codex configuration does not automatically enable tools in cloud sessions.

```sh
codex mcp add my_hosting --url https://connector.example.com/mcp
codex mcp login my_hosting --scopes accounts:read,cpanel:read,offline_access
codex mcp list
```

Complete the browser sign-in and consent. A `/mcp` browser GET is not an authenticated tool test; open `/mani_admin` for the human login. A plugin wrapper version can differ from the source/server version. Refresh custom-client metadata when tool definitions change and verify a read-only hosting call in each client.

## 7. Use the connector

Start with read-only prompts such as “List my connected hosting profiles”, “List domains on my cPanel account” or “List files in public_html”. Select the intended account when multiple profiles exist. Changes such as mailbox deletion or unrestricted UAPI/WHM calls require the corresponding write grant and the client’s own action policies.

| Tool | Purpose |
|---|---|
| `cpanel_list_accounts` | List profile metadata, never saved secrets |
| `cpanel_list_domains` | Read domains |
| `cpanel_list_email_accounts` | Read mailboxes |
| `cpanel_list_files` | Read a directory listing |
| `cpanel_create_email_account` / `cpanel_delete_email_account` | Manage mailboxes |
| `cpanel_uapi_execute` | Broad hosting UAPI operations |
| `whm_api_read` / `whm_api_execute` | WHM reads or broad server operations |
| `hosting_disconnect_connection` | Remove that owner's encrypted saved profile |

Available operations depend on the actual hosting credential. The connector does not grant privileges absent from cPanel/WHM. A disconnected OAuth client and a removed cPanel profile are different actions. Remote token revocation is separate and requires a saved token name and appropriate hosting permission.

### Browser uploads and optional downloads

Open `/mani_admin/uploads` after signing in. Staged cPanel uploads allow 1,000,000,000 bytes per file, one active upload per user and six hours to complete. Browser chunks can be 8 MiB, while MCP chunks are limited to 500,000 decoded bytes. Browser status supports resume and retry; this does not add a new MCP status tool. Check the destination filename after completion. Uploading can replace an existing destination file.

Direct browser download is optional and only works when the connector shares the target cPanel account’s filesystem. Configure `LOCAL_DOWNLOAD_ROOT`, `LOCAL_DOWNLOAD_CPANEL_HOST` and `LOCAL_DOWNLOAD_CPANEL_USERNAME` privately; it is disabled unless all three are supplied. The saved profile must match and file paths are confined to the configured root. See [the capability reference](CPANEL-CAPABILITY-AUDIT.md).

## 8. Install on cPanel hosting

You need Node 22.19 or newer, supported Passenger/Node application hosting, PostgreSQL, an HTTPS hostname and working SMTP or local sendmail. cPanel software availability depends on the host and plan. Check the real account rather than assuming every cPanel server supports Node/PostgreSQL. Check prerequisites on your own hosting plan.

1. Extract the full project ZIP on your computer. Find `packages/cpanel-server.zip`.
2. Create a dedicated PostgreSQL database and a separate database user. Grant that user access. On hosts that disallow a database and user with the same name, use distinct names. Preserve any account prefix.
3. Create a new connector subdomain with its own document root. Do not replace another site's public_html.
4. Use cPanel **Setup Node.js App**: Node 22+, production mode, an application directory outside the public document root, root application URI and startup file `app.js`.
5. Extract `cpanel-server.zip` into that application directory and run the selector's **NPM Install** action. Do not upload Windows node_modules.
6. Copy `deploy/cpanel/runtime.example.json` to a private input file outside the application and public web roots. Replace its example URLs, owner email, database names/password and mail values.
7. From the full source checkout, initialize the private file once:

```sh
node scripts/init-hosted-config.mjs --input /home/ACCOUNT/private/input.json --output /home/ACCOUNT/private/runtime.json
```

The input and its containing folder must be private. The parent output folder must be owner-only 0700 on Linux; the runtime file is 0600. The script generates the encryption key once, prints no key and refuses to overwrite an existing file. Securely dispose of the redundant private input after checking the resulting configuration.

8. Set the Node app environment variable `PARMTECH_CONFIG_FILE` to that absolute private runtime file. Do not put actual keys in the startup source, repository or public document root.
9. Configure trusted reverse-proxy handling for the actual host, enable HTTPS and HTTP-to-HTTPS redirect, then restart the app using the supported manager.
10. Check `/health`, OAuth metadata and anonymous MCP rejection. Open `/mani_admin` and complete owner setup.

The application root is CommonJS for Passenger's startup loader; `dist` is ESM. Passenger requires the startup module rather than executing it as the main script, so startup must not depend on `require.main === module`.

Some shared hosts reject Docker and persistent custom daemons. Use their managed Node app facility. Passenger may idle the process and restart it on demand; data persists in PostgreSQL/private files, so Windows need not remain powered on.

## 9. Install with Docker on a suitable server

1. Install a supported Docker/Compose runtime and a TLS reverse proxy on your own suitable host.
2. Copy `.env.example` to a private `.env`. Set the HTTPS base URL, official-site redirect, owner email, a strong database password and working SMTP values.
3. Generate a 32-byte base64 encryption key once using a password manager or Node's cryptographic random generator, store it in that private environment file and keep it unchanged across restarts.
4. Run:

```sh
docker compose up -d --build
```

5. The app binds locally on port 3210. Put the HTTPS reverse proxy in front; keep PostgreSQL private and preserve its named volume.
6. Run health checks and complete `/mani_admin` setup.

The Compose app filesystem is read-only and database state is in a persistent volume. `PRIVATE_UPLOAD_DIR` and `PRIVATE_PLAY_BUNDLE_DIR` point to separate `/tmp` staging directories in the provided Compose file. Its `/tmp` tmpfs consumes host memory and is cleared on container restart, so unfinished transfers are lost; provision enough space or configure a private persistent writable mount for larger transfers. SMTP is normally needed because the app container does not include a local mail server. The optional PARMTECH-specific import is disabled unless an operator explicitly configures it.

## 10. Let’s Encrypt and renewal

Use your hosting provider’s supported certificate automation, or configure the optional renewal scripts below for your own domain. No other installation’s certificate, private key or renewal job is distributed.

For another installation, configure `CPANEL_DNS_ZONE` to the actual authoritative cPanel zone, and use `scripts/configure-ssl-renewal.mjs` with private runtime and private cPanel credential input files. The credential input format is `host`, `username`, `apiToken`; never include an actual input in this project ZIP. The script creates an AES-GCM-encrypted `ssl-auth.enc` next to the private runtime file and refuses overwriting it.

```sh
node scripts/configure-ssl-renewal.mjs --config /home/ACCOUNT/private/runtime.json --credentials /home/ACCOUNT/private/cpanel-input.json --output /home/ACCOUNT/private/ssl-auth.enc
```

Install the Node dependencies, then schedule the included renewer using the real node path. For the unpacked cPanel runtime package, an example daily command is:

```sh
PARMTECH_OPERATIONS_DIR=/home/ACCOUNT/private /path/to/node /home/ACCOUNT/connector-app/renew-ssl.mjs
```

The private runtime supplies the hostname and DNS zone. DNS-01 adds/removes only the exact challenge record. The certificate and ACME account key persist in private storage. The renewer renews within 30 days of expiry and installs through cPanel. Do not create a new ACME account or certificate every few minutes. Set private monitoring for nonzero exit status and configure your own failure notifications.

Other hosts may provide automatic certificates themselves; use their supported certificate process if the required DNS/SSL APIs are unavailable. Do not disable TLS verification as a workaround.

## 11. Keep credentials across restarts and updates

Back up the PostgreSQL database and the stable encryption key/private runtime configuration securely, independently of replaceable application files. Restoring only the database without its original key will not recover encrypted profiles. Replacing the key is not a password reset.

For updates, back up state, replace only application code, install the matching dependencies, restart through the host manager and check health/login/read-only tools. Do not delete tables, the private configuration or owner-import receipts. Keep old application code for rollback; review migrations before downgrading. An app/server restart does not intentionally delete saved hosting credentials.

OAuth access tokens last about 1 hour; rotating refresh grants last 30 days. An expired/revoked client grant may need browser login again, while the saved hosting profile can still remain intact. A hosting API token that expires or is revoked must be replaced deliberately.

## 12. Local Windows prototype

The local mode is useful for development or desktop-only use. With Node22.19+ installed, run `npm ci` and `npm run build` in the extracted full source folder first. Then run `Setup cPanel Connection.cmd`, enter the credential in its loopback browser form and save it to Windows Credential Manager. `Enable Automatic Startup.cmd` starts its loopback HTTP process after that same Windows user logs in. That local mode still depends on the PC; it is not the hosted 24/7 route.

Never expose the unauthenticated loopback development endpoint publicly. The running old plugin can retain outdated code until it is reloaded/reinstalled; replacing source files alone may not refresh that installed process.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| Admin link opens first-time setup | No initial admin has completed verified setup yet |
| Setup code does not arrive | Installer owner email, SMTP/sendmail, spam folder and private mail-delivery logs |
| Setup code rejected | Original tab/browser, 15 minute expiry, correct 8 digits and five-attempt limit |
| Wrong owner email | Match `SETUP_OWNER_EMAIL`; a public visitor cannot choose another first admin |
| Login callback timed out | Start a fresh client OAuth login; do not regenerate cPanel credentials |
| `/mcp` shows 405 in browser | Use it in an MCP client; open `/mani_admin` for the web UI |
| Invalid UAPI response | Correct cPanel host/2083 and an updated response parser; not proof that a token was erased |
| Saved credential cannot decrypt | Restore the original encryption key paired with that database backup |
| Passenger 503 | Startup module loading, Node version, private-file permissions, installed packages and database access |
| PostgreSQL user-creation error | Database/user name conflicts, required account prefixes and grants |
| Root shows official website | Expected; there is no connector marketing frontend |
| Owner migration re-add concern | A durable receipt preserves intentional disconnects |

## 14. Public GitHub, website and ChatGPT distribution

The full distribution includes source, build/test scripts, operator/user documentation, a server runtime ZIP, remote manifests, MIT licence and SHA256/file manifests. It excludes actual hosting credentials, database dumps, private keys, owner receipts, local work directories, Windows credential data and node_modules.

The source repository is https://github.com/parmtech/parmtech-cpanel-connector, separate from the Android Flutter project. Run the tests, secret/content checks and dependency review before every release. The included CI template uses fixture credentials and PostgreSQL in an isolated test service. A website can link the checked source/release ZIP and checksum after owner review; do not publish a live `.env` or private runtime backup.

Public ChatGPT distribution is a separate submission/review process, not a consequence of creating a GitHub repository or ZIP. Review current [plugin guidance](https://developers.openai.com/plugins/quickstart), [Apps SDK submission guidance](https://developers.openai.com/apps-sdk/deploy/submission/) and the platform's actual integration path. Prepare working reviewer access, accurate tool scopes, privacy/support/terms pages, ownership/branding and failure/revocation tests. No public ChatGPT listing or directory approval is claimed.

Before opening a general public hosted service, complete independent security/tenant-isolation review, password recovery, monitoring, backup/restore drills, abuse controls and real cPanel/WHM acceptance. Keep your own deployment’s registration allowlist restricted until it is ready for additional users.

## 15. Validation and limits

Build and mock/local/config/owner-import tests run using `npm test`. Real PostgreSQL first-admin tests use `npm run test:setup-db` against an operator-controlled connection; they create and drop a uniquely named test schema, never the live public schema.

The current first-admin database tests cover browser binding, expiry, five wrong attempts, send throttling, concurrent setup, closure after one admin, password hashing and reconnecting through a fresh pool. HTTP checks reject bad CSRF/wrong-owner requests without sending mail. Your deployment’s email delivery, browser authorization and authenticated hosting calls require separate acceptance checks; fixture tests do not establish these outcomes.
