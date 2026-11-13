# PARMTECH cPanel Connector — complete setup and user guide

Version: 0.2.0-alpha.2 · Prepared 13 November 2026

## 1. What is in this project?

This connector lets an OAuth-capable MCP client manage user-authorized cPanel UAPI and WHM API1 accounts. It includes a hosted Node.js server, PostgreSQL storage, first-time administrator setup, a private settings portal, OAuth/PKCE, remote plugin manifests, a Windows/local development prototype and deployment tools.

The current PARMTECH installation is an owner-restricted alpha. Open-source distribution and a public multi-user hosted service are different things. Anyone may self-host the source under its MIT licence; the PARMTECH production endpoint is not automatically open for everybody to register.

The separate `parmtech/cpanel-admin` GitHub repository is an Android Flutter companion. It is not this Node/MCP server, and its APK is not included or silently integrated here.

## 2. Which login is which?

| Login | Purpose | What you enter |
|---|---|---|
| Connector administrator | Manage this connector installation and your saved hosting profiles | Your verified owner email and the new password you create during setup |
| cPanel/WHM hosting profile | Permit hosting API operations | Server hostname, hosting username and API token; password authentication is also supported where permitted by the host |
| ChatGPT/Codex or another MCP client | Authorize that client to use connector tools | Your normal client account plus the connector OAuth consent flow |

There is no built-in shared administrator password. Do not use your email mailbox password, ChatGPT password or cPanel password as an assumed connector password. The first-time wizard creates a new connector login. Passwords are stored as scrypt hashes; saved hosting secrets are encrypted separately.

For the current owner installation, use `info@parmtech.au`. The password is whatever the owner chooses in the wizard. No password is included in this ZIP or documentation.

## 3. Current URLs

| URL | Behaviour |
|---|---|
| `https://connector.parmtech.au/` | Redirects to the official `https://parmtech.au/` website |
| `https://connector.parmtech.au/mani_admin` | First-time setup, then normal connector login/settings |
| `https://connector.parmtech.au/mcp` | Remote MCP endpoint for a client; not a normal web page |
| `https://connector.parmtech.au/health` | Service health response |

There is no separate public marketing frontend on the connector host. OAuth metadata and authorization routes remain reachable because clients need them. Knowing the admin URL does not grant access.

Self-hosters replace these hostnames with their own. Use lowercase `/mani_admin` exactly; it contains an underscore, not a space.

## 4. First-time administrator setup

1. Open `/mani_admin` over HTTPS.
2. Enter the owner email configured by the installer in `SETUP_OWNER_EMAIL`.
3. Press **Send verification code**. Read the eight-digit code in that mailbox.
4. Keep the original browser tab open. Enter the code, a new password of12–256 characters, and its confirmation.
5. Press **Create admin login**. The email is verified and the first administrator is created atomically.
6. Later visits show the normal email/password login instead of first-time setup.

The code expires after15minutes, is bound to the requesting browser and permits at most5wrong code attempts. At most3setup codes per owner email can be requested in15minutes. Concurrent setup submissions cannot create two initial administrators. A random first website visitor cannot choose an unrelated mailbox and claim the installation.

The trusted setup email is chosen during server installation, not by an unauthenticated visitor. A self-hoster supplies their own email in the private configuration. If mail delivery is not configured, setup does not create an administrator without verification.

An owner email change after setup does not reset the existing administrator. Do not erase the database to change a password. Automated password-recovery UI is not included in this alpha; recovery requires an authenticated operator procedure and must be completed before a general public hosted launch.

## 5. Add or migrate a hosting connection

After login, choose **Add another connection** and fill in:

| Field | Example or meaning |
|---|---|
| Connection label | A friendly name such as `My hosting` |
| Server hostname | `server.yourhost.com`; no cPanel session path such as `/cpsess...` |
| Hosting username | The cPanel or WHM account name, not the connector email |
| Access level | cPanel account or WHM server |
| Credential type | API token, or username/password if the hosting policy permits |
| Secret | Enter only into the masked HTTPS form |
| Token name | Optional descriptive token name; it is not the token value |

cPanel uses HTTPS2083; WHM uses HTTPS2087. A hosting provider can restrict API permissions or password authentication. WHM can affect multiple accounts; use it deliberately. The connector validates the credential before saving it. Use dedicated credentials appropriate to the hosting account.

In the current PARMTECH owner migration, the previously saved cPanel connection can be imported once after the configured owner has verified and signed in. The browser never receives that saved token. A receipt prevents an intentionally disconnected connection from being silently restored. Other self-hosters do not receive PARMTECH credentials, and this optional migration is not enabled in the public example configuration.

## 6. Connect an MCP client

The protocol is **Streamable HTTP with OAuth**. Give the client the `/mcp` URL, start authorization, sign into the connector and review its scopes. Select read-only scopes when writes are not needed. The `offline_access` scope permits rotating refresh tokens.

For Codex, the installed CLI supports:

```sh
codex mcp add parmtech_hosted --url https://YOUR-CONNECTOR-HOST/mcp
codex mcp login parmtech_hosted --scopes accounts:read,accounts:write,cpanel:read,cpanel:write,offline_access
```

The first command can itself begin login. Complete the browser flow before its callback expires; if it expires, restart login. No cPanel token belongs in these commands or chat. The existing local plugin does not automatically switch to a remote server.

For ChatGPT, use the current supported custom-MCP/plugin creation flow for your account or workspace and select OAuth. Menu names and availability depend on the product. This source package is not proof of public directory approval. See [OpenAI's custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) and [developer-mode documentation](https://help.openai.com/en/articles/12584461).

The private owner remote manifest uses the live PARMTECH endpoint. A public self-hosting package uses an example endpoint that the installer must replace. A GET request opening `/mcp` in a browser may return405 because the MCP endpoint expects protocol POST requests; use `/mani_admin` for a web login.

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

## 8. Install on cPanel hosting

You need Node22.19or newer, supported Passenger/Node application hosting, PostgreSQL, an HTTPS hostname and working SMTP or local sendmail. cPanel software availability depends on the host and plan. Check the real account rather than assuming every cPanel server supports Node/PostgreSQL. The current owner's plan was checked.

1. Extract the full project ZIP on your computer. Find `packages/cpanel-server.zip`.
2. Create a dedicated PostgreSQL database and a separate database user. Grant that user access. On hosts that disallow a database and user with the same name, use distinct names. Preserve any account prefix.
3. Create a new connector subdomain with its own document root. Do not replace another site's public_html.
4. Use cPanel **Setup Node.js App**: Node22+, production mode, an application directory outside the public document root, root application URI and startup file `app.js`.
5. Extract `cpanel-server.zip` into that application directory and run the selector's **NPM Install** action. Do not upload Windows node_modules.
6. Copy `deploy/cpanel/runtime.example.json` to a private input file outside the application and public web roots. Replace its example URLs, owner email, database names/password and mail values.
7. From the full source checkout, initialize the private file once:

```sh
node scripts/init-hosted-config.mjs --input /home/ACCOUNT/private/input.json --output /home/ACCOUNT/private/runtime.json
```

The input and its containing folder must be private. The parent output folder must be owner-only0700 on Linux; the runtime file is0600. The script generates the encryption key once, prints no key and refuses to overwrite an existing file. Securely dispose of the redundant private input after checking the resulting configuration.

8. Set the Node app environment variable `PARMTECH_CONFIG_FILE` to that absolute private runtime file. Do not put actual keys in the startup source, repository or public document root.
9. Configure trusted reverse-proxy handling for the actual host, enable HTTPS and HTTP-to-HTTPS redirect, then restart the app using the supported manager.
10. Check `/health`, OAuth metadata and anonymous MCP rejection. Open `/mani_admin` and complete owner setup.

The application root is CommonJS for Passenger's startup loader; `dist` is ESM. Passenger requires the startup module rather than executing it as the main script, so startup must not depend on `require.main === module`.

Some shared hosts reject Docker and persistent custom daemons. Use their managed Node app facility. Passenger may idle the process and restart it on demand; data persists in PostgreSQL/private files, so Windows need not remain powered on.

## 9. Install with Docker on a suitable server

1. Install a supported Docker/Compose runtime and a TLS reverse proxy on your own suitable host.
2. Copy `.env.example` to a private `.env`. Set the HTTPS base URL, official-site redirect, owner email, a strong database password and working SMTP values.
3. Generate a32-byte base64 encryption key once using a password manager or Node's cryptographic random generator, store it in that private environment file and keep it unchanged across restarts.
4. Run:

```sh
docker compose up -d --build
```

5. The app binds locally on port3210. Put the authenticated HTTPS reverse proxy in front; keep PostgreSQL private and preserve its named volume.
6. Run health checks and complete `/mani_admin` setup.

The Compose app filesystem is read-only and database state is in a persistent volume. SMTP is normally needed because the app container does not include a local mail server. The optional PARMTECH-specific import is disabled unless an operator explicitly configures it.

## 10. Let’s Encrypt and renewal

The current installation has a Let’s Encrypt certificate on `connector.parmtech.au`, with daily server-side renewal checks. No Windows task is used. The initial certificate is valid through10February2027.

For another installation, configure `CPANEL_DNS_ZONE` to the actual authoritative cPanel zone, and use `scripts/configure-ssl-renewal.mjs` with private runtime and private cPanel credential input files. The credential input format is `host`, `username`, `apiToken`; never include an actual input in this project ZIP. The script creates an AES-GCM-encrypted `ssl-auth.enc` next to the private runtime file and refuses overwriting it.

```sh
node scripts/configure-ssl-renewal.mjs --config /home/ACCOUNT/private/runtime.json --credentials /home/ACCOUNT/private/cpanel-input.json --output /home/ACCOUNT/private/ssl-auth.enc
```

Install the Node dependencies, then schedule the included renewer using the real node path. For the unpacked cPanel runtime package, an example daily command is:

```sh
PARMTECH_OPERATIONS_DIR=/home/ACCOUNT/private /path/to/node /home/ACCOUNT/connector-app/renew-ssl.mjs
```

The private runtime supplies the hostname and DNS zone. DNS-01 adds/removes only the exact challenge record. The certificate and ACME account key persist in private storage. The renewer renews within30days of expiry and installs through cPanel. Do not create a new ACME account or certificate every few minutes. Set a private log/monitor for nonzero exit status; the current installation also has a Punjabi failure-email wrapper.

Other hosts may provide automatic certificates themselves; use their supported certificate process if the required DNS/SSL APIs are unavailable. Do not disable TLS verification as a workaround.

## 11. Keep credentials across restarts and updates

Back up the PostgreSQL database and the stable encryption key/private runtime configuration securely, independently of replaceable application files. Restoring only the database without its original key will not recover encrypted profiles. Replacing the key is not a password reset.

For updates, back up state, replace only application code, install the matching dependencies, restart through the host manager and check health/login/read-only tools. Do not delete tables, the private configuration or owner-import receipts. Keep old application code for rollback; review migrations before downgrading. An app/server restart does not intentionally delete saved hosting credentials.

OAuth access tokens last about1hour; rotating refresh grants last30days. An expired/revoked client grant may need browser login again, while the saved hosting profile can still remain intact. A hosting API token that expires or is revoked must be replaced deliberately.

## 12. Local Windows prototype

The local mode is useful for development or desktop-only use. With Node22.19+ installed, run `npm ci` and `npm run build` in the extracted full source folder first. Then run `Setup cPanel Connection.cmd`, enter the credential in its loopback browser form and save it to Windows Credential Manager. `Enable Automatic Startup.cmd` starts its loopback HTTP process after that same Windows user logs in. That local mode still depends on the PC; it is not the hosted24/7 route.

Never expose the unauthenticated loopback development endpoint publicly. The running old plugin can retain outdated code until it is reloaded/reinstalled; replacing source files alone may not refresh that installed process.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| Admin link opens first-time setup | No initial admin has completed verified setup yet |
| Setup code does not arrive | Installer owner email, SMTP/sendmail, spam folder and private mail-delivery logs |
| Setup code rejected | Original tab/browser,15minute expiry, correct8digits and five-attempt limit |
| Wrong owner email | Match `SETUP_OWNER_EMAIL`; a public visitor cannot choose another first admin |
| Login callback timed out | Start a fresh client OAuth login; do not regenerate cPanel credentials |
| `/mcp` shows405 in browser | Use it in an MCP client; open `/mani_admin` for the web UI |
| Invalid UAPI response | Correct cPanel host/2083 and an updated response parser; not proof that a token was erased |
| Saved credential cannot decrypt | Restore the original encryption key paired with that database backup |
| Passenger503 | Startup module loading, Node version, private-file permissions, installed packages and database access |
| PostgreSQL user-creation error | Database/user name conflicts, required account prefixes and grants |
| Root shows official website | Expected; there is no connector marketing frontend |
| Owner migration re-add concern | A durable receipt preserves intentional disconnects |

## 14. Public GitHub, website and ChatGPT distribution

The full distribution includes source, build/test scripts, operator/user documentation, a server runtime ZIP, remote manifests, MIT licence and SHA256/file manifests. It excludes actual hosting credentials, database dumps, private keys, owner receipts, local work directories, Windows credential data and node_modules.

The source repository is https://github.com/parmtech/parmtech-cpanel-connector, separate from the Android Flutter project. Run the tests, secret/content checks and dependency review before every release. The included CI template uses fixture credentials and PostgreSQL in an isolated test service. A website can link the checked source/release ZIP and checksum after owner review; do not publish a live `.env` or private runtime backup.

Public ChatGPT distribution is a separate submission/review process, not a consequence of creating a GitHub repository or ZIP. Review current [plugin guidance](https://developers.openai.com/plugins/quickstart), [Apps SDK submission guidance](https://developers.openai.com/apps-sdk/deploy/submission/) and the platform's actual integration path. Prepare working reviewer access, accurate tool scopes, privacy/support/terms pages, ownership/branding and failure/revocation tests. No public ChatGPT listing or directory approval is claimed.

Before opening a general public hosted service, complete independent security/tenant-isolation review, password recovery, monitoring, backup/restore drills, abuse controls and real cPanel/WHM acceptance. The current production owner allowlist remains unchanged.

## 15. Validation and limits

Build and mock/local/config/owner-import tests run using `npm test`. Real PostgreSQL first-admin tests use `npm run test:setup-db` against an operator-controlled connection; they create and drop a uniquely named test schema, never the live public schema.

The current first-admin database tests cover browser binding, expiry, five wrong attempts, send throttling, concurrent setup, closure after one admin, password hashing and reconnecting through a fresh pool. HTTP checks reject bad CSRF/wrong-owner requests without sending mail. Final owner email receipt, chosen password and client authorization remain user acceptance steps, not fabricated test successes.
