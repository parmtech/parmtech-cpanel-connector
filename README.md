# PARMTECH cPanel Connector

Connect an MCP client to **your own cPanel or WHM account**. Run the local cPanel connector on your computer, or deploy the remote OAuth server on infrastructure you control.

**Source version: 0.2.0-alpha.4.** The project is MIT-licensed alpha software. Downloading the source does not create a hosted account, install a ChatGPT plugin or grant access to somebody else's hosting. Use your own server, domain and credentials.

## Start here

| What you want | Guide |
| --- | --- |
| Set up a connector for your hosting | [Self-hosting and local setup](docs/SELF-HOSTING.md) |
| Connect Codex, ChatGPT, Claude, VS Code or Cursor | [Client setup and verification](docs/CLIENT-SETUP.md) |
| Use an already deployed connector | [Quickstart](docs/QUICKSTART.md) |
| Deploy on cPanel/CloudLinux with Passenger | [cPanel deployment](deploy/cpanel/README.md) |
| Browse the full handbook | [Complete guide](docs/COMPLETE-GUIDE.md) · [Standalone HTML](docs/START-HERE.html) |
| Ask an assistant to guide your installation | [Copyable setup prompt](docs/SELF-HOSTING.md#copyable-prompt-for-your-ai-assistant) |

## Two ways to run it

| | Local cPanel connector | Hosted OAuth connector |
| --- | --- | --- |
| Runs on | Your computer as a client-launched process | Your own server |
| Transport | MCP stdio; loopback HTTP for development | Streamable HTTP over HTTPS |
| Hosting accounts | cPanel API token | cPanel or WHM, token recommended |
| Credentials | Operating-system credential store | Per-user encrypted PostgreSQL records |
| Requirements | Node.js 22.19+, npm, working OS keyring | Node.js 22.19+, PostgreSQL, HTTPS, mail delivery |
| Client setup | Local MCP configuration | Remote URL plus connector OAuth login |

The hosted service operates independently of your computer. A managed host may idle or restart its Node process; the database and private configuration preserve account state. The modes have separate saved accounts and authorization.

## What is included

- cPanel account, domain, mailbox and file listings; mailbox creation/deletion.
- Dedicated file uploads and archive extraction, plus broad cPanel UAPI and legacy API 2 tools.
- WHM API 1 with a conservative read-only function allowlist and a separate broad write-capable tool.
- Multiple labeled hosting connections, verified first-administrator setup, a browser settings portal, OAuth authorization code flow with PKCE, Dynamic Client Registration, resource-bound grants and rotating refresh tokens.
- Resumable staged cPanel transfers up to **1,000,000,000 bytes**, with a six-hour lifetime, and a signed-in browser upload page at `/mani_admin/uploads`. MCP chunks are limited to 500,000 decoded bytes; browser chunks can be 8 MiB. Hosting upload limits and free disk space still apply. An MCP client or app may retain an older, lower tool-schema limit; refresh its tool definitions if supported and verify its advertised limit. This does not change the hosting provider’s own limits.
- Optional browser download access for a connector running on the same cPanel account filesystem, disabled until explicitly configured. See [file-transfer limits](docs/CPANEL-CAPABILITY-AUDIT.md).
- Optional, separately authorized [GitHub](docs/GITHUB-CONNECTOR.md) and [Google Play](docs/PLAY-BUNDLE-UPLOAD.md) MCP resources. Play supports staged AAB uploads; uploading a bundle does not publish a release.
- Docker and cPanel/Passenger deployment templates, Windows local setup helpers, fixture tests and distribution tooling.

## Connect using your own server

After [deploying](docs/SELF-HOSTING.md#option-b-host-your-own-remote-connector), open `https://connector.example.com/mani_admin`, finish first-admin verification, and add your own cPanel or WHM profile. Replace the reserved example hostname throughout these examples.

For a local Codex client connecting to that server:

```sh
codex mcp add my_hosting --url https://connector.example.com/mcp
codex mcp login my_hosting --scopes accounts:read,cpanel:read,offline_access
codex mcp list
```

For ChatGPT web, create an OAuth custom MCP plugin with your `/mcp` endpoint in the available Plugins interface. Local Codex configuration does not automatically configure a hosted web/cloud session. Follow the [client-specific guide](docs/CLIENT-SETUP.md), including its official documentation links and verification checklist.

The `/mcp` URL is a protocol endpoint. Use `/mani_admin` for browser login. Your connector password, hosting API token and MCP client's account login have different purposes; enter hosting secrets only in your connector's private form or the local hidden prompt.

## Permissions and tools

| Capability | Tools / permissions |
| --- | --- |
| Saved profile metadata | `cpanel_list_accounts`, `accounts:read` |
| cPanel listings | `cpanel_list_domains`, `cpanel_list_email_accounts`, `cpanel_list_files`, `cpanel:read` |
| Mailbox changes | `cpanel_create_email_account`, `cpanel_delete_email_account`, `cpanel:write` |
| Small or public-URL uploads | `cpanel_upload_file`, `cpanel:write` |
| Staged uploads | `cpanel_begin_file_upload`, `cpanel_append_file_chunk`, `cpanel_finish_file_upload`, `cpanel_cancel_file_upload`, `cpanel:write` |
| ZIP extraction | `cpanel_extract_archive`, `cpanel:write` |
| Broad cPanel API calls | `cpanel_uapi_execute`, `cpanel_api2_execute`, `cpanel:write` |
| Allowlisted WHM reads | `whm_api_read`, `whm:read` |
| Broad WHM administration | `whm_api_execute`, `whm:write` |
| Remove a hosted saved profile | `hosting_disconnect_connection`, `accounts:write` |
| Refresh authorization | `offline_access` |

A broad API tool requires its write scope even if a particular function only reads data. All operations remain limited by the actual cPanel/WHM account, token ACLs, enabled server features and client policy. WHM authority can extend across hosting accounts. Removing a saved profile and revoking the upstream token are separate operations.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/hosted/` | HTTP server, browser account flows, OAuth, database, encryption and transfer staging |
| `src/tools.ts`, `src/uapi.ts`, `src/whm.ts` | Hosting tool schemas and API clients |
| `src/github/` | GitHub OAuth and isolated `/github/mcp` resource |
| `src/play/` | Google Play service-account integration, tools and AAB uploads |
| `src/index.ts`, `src/setup.ts`, `src/store.ts` | Local entrypoint, account setup and OS credential storage |
| `deploy/cpanel/` | Passenger startup and private-configuration templates |
| `scripts/` | Build, validation, packaging and deployment helpers |
| `plugin.json`, `mcp.json` | Distributable plugin metadata and a placeholder MCP endpoint |

The source package version, a deployed server's reported version, and a ChatGPT app-wrapper version are independent. Compare the source revision and deployed behavior when troubleshooting; matching version labels alone do not establish identical code.

## Development

```sh
npm ci
npm run build
npm test
```

`npm run test:setup-db` additionally needs an isolated operator-supplied PostgreSQL test database. Test scripts are not a substitute for your own mail delivery, OAuth and hosting-account acceptance checks. See [validation and limits](docs/COMPLETE-GUIDE.md#15-validation-and-limits).

## Operational limits

Use one server instance while rate limiting is process-local. Keep the original 32-byte credential encryption key and matching database backups; automated key rotation is not included. Automated password recovery is not part of this source version. A private, restricted installation is the default starting point; opening a general public service needs its own operational and security readiness work.

The hosted operator controls the encryption key and can decrypt saved credentials. Keep runtime configuration, database dumps, API tokens, OAuth secrets and private keys out of Git and distribution archives. Public examples contain placeholders only. See [SECURITY.md](SECURITY.md).

## License and attribution

[MIT](LICENSE). Third-party dependencies retain their own licenses; see [third-party notices](docs/THIRD-PARTY-NOTICES.md). PARMTECH is independent; cPanel® and WHM® are third-party trademarks. No public ChatGPT directory approval or third-party endorsement is implied.
