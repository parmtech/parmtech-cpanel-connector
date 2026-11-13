# Windows integration verification and handoff

Verified on 13 November 2026. Status: partially completed; owner OAuth sign-in remains required.

## Architecture and software

Use `https://connector.parmtech.au/mcp` directly with Streamable HTTP and OAuth. The production Passenger/Node/PostgreSQL service runs independently of Windows. No new Windows connector server, Node installation, inbound firewall rule or startup task was required.

The latest published source verified during this work was `v0.2.0-alpha.3`, main commit `848ef1f43c75d42b12054909febcc6fa9b443f8e`. The source requires Node >=22.19.0. The target had Windows 11 Pro x64 (10.0.26300), Node 22.23.2, npm 10.9.8, Git 2.56.0.windows.4 and Codex CLI 0.167.0-alpha.4.1. The running desktop package was OpenAI.Codex 26.1106.6628.0 and contained ChatGPT.exe; a separate legacy ChatGPT desktop installation was not established.

Execution used the already authorized desktop session and PowerShell as the interactive Windows owner, without elevation. Several repository-specific Actions runner services existed under NETWORK SERVICE, scoped to other repositories. Their logs contained successful listening sessions, but this is not a current GitHub online-status check. No connector-scoped runner was established. Runner labels and current GitHub registration status could not be verified: the connected GitHub tool rejects the runner administration endpoint. The connector repository has an Ubuntu source-check workflow, not a Windows deployment workflow. No runner was repurposed or re-registered. NETWORK SERVICE cannot be assumed to share the interactive owner's Credential Manager or Codex profile.

## Configuration and changes

`%USERPROFILE%\.codex\config.toml` already contained the enabled `parmtech_hosted` URL. Fresh `codex mcp get parmtech_hosted` invocations read it correctly. No duplicate was added and the configuration hash remained unchanged. A private, owner/SYSTEM-restricted backup of the config and local account metadata was made outside the repository in the installation task's `private-backup` directory. Credentials were not exported or changed.

The private account plugin named `parmtech-cpanel-connector` had an example hostname in both `mcp.json` and `.mcp.json`. The same plugin identity was updated through Plugin Creator to **package version 0.2.0-alpha.4**, replacing that hostname with the production endpoint and synchronizing both manifest versions. Read-back verified both configurations. Identity, private personal scope, audience, assets, prompts and unrelated files were preserved. This plugin package version is separate from the unchanged server/source version. The generic public self-host template intentionally retains its example hostname.

The desktop cache still showed the older remote package at the time of inspection. A saved account release does not prove the host activated it. Use the plugin's normal update/connect interface; do not patch cached files or assume Codex CLI authentication also authenticates ChatGPT.

## Commands and actual results

Executed: source clone and release/commit inspection; software version commands; `codex mcp list`; `codex mcp get parmtech_hosted`; `codex mcp login --help`; read-only service, process, task, runner metadata and log inspection; and the anonymous probe below.

```powershell
pwsh -NoProfile -File scripts/verify-hosted.ps1
codex mcp login parmtech_hosted --scopes accounts:read,cpanel:read,offline_access
```

The OAuth attempt successfully registered a client and opened the legitimate PARMTECH sign-in page with PKCE S256, the exact MCP resource and the three requested scopes. It did not complete owner sign-in, token exchange or authenticated MCP initialization. An earlier noninteractive `--no-browser` diagnostic exited when stdin closed; it was not an authentication success. Do not save authorization URLs or callback codes in Git or logs.

| Test | Actual outcome |
| --- | --- |
| TLS | PASS: normal hostname/chain validation, TLS 1.3, Let's Encrypt YR1, leaf expiry 2027-02-10 21:42:05 UTC |
| Health | PASS: HTTP 200, `{"status":"ok"}` |
| OAuth authorization metadata | PASS: HTTP 200; same-origin authorization/token/register/revoke endpoints; public client and S256 |
| Protected resource discovery | PASS: HTTP 200 at `/.well-known/oauth-protected-resource/mcp`, advertised by the 401 challenge |
| Bare protected-resource path | HTTP 404; clients must follow the advertised resource-specific path |
| Anonymous MCP initialize | PASS: HTTP 401, `invalid_token`, missing Authorization header |
| Admin and root | PASS: admin HTTP 200; root HTTP 302 to `https://parmtech.au/` |
| Codex configuration persistence | PASS across fresh CLI processes; full desktop restart not performed |
| Hosted OAuth and tool discovery | NOT TESTED to completion: owner sign-in required |
| Existing local connector account listing | PASS: one saved account, metadata only |
| Existing local domains/mailboxes/directory | PASS: UAPI `result.status=1`, domains included main `parmtech.au`; mailbox names and `public_html` entries returned |
| Hosted hosting-account reads | NOT TESTED: local results do not establish hosted tenant import or OAuth success |

The existing local plugin version 0.3.4 successfully returned the four read-only results in this session; the previously reported UAPI envelope failure did not recur. Its OS credential store is readable in this owner context. An older local 0.3.1 HTTP process also listened only on 127.0.0.1:3210; its empty background logs and existing processes were left intact. No matching PARMTECH/connector runner startup task was found by name. There was no need to delete credentials, stop working processes or install another server.

## Resume after owner authorization

1. Start a fresh Codex login command above when the owner can complete the private browser sign-in. Existing OAuth transaction/callback listeners expire; do not reuse stale links. Enter passwords or verification codes only into the HTTPS PARMTECH page. Do not send them or callback URLs through chat. This Codex flow uses a loopback callback on the PC, so opening its URL on Android alone does not complete the Windows callback.
2. If initial administrator setup is still needed, the owner completes `/mani_admin` and chooses the password. Never create/reset that password or bypass email verification on the owner's behalf. An HTTP page title alone does not prove setup is finished.
3. For ChatGPT, open the existing private plugin's account page, apply its saved update if offered, and connect using OAuth. Verify the real hostname before sign-in and grant only needed read scopes. This is a separate client grant from Codex. Client availability on Android must be checked in the actual account UI.
4. Confirm authenticated initialization and `tools/list`, then call accounts, domains, mailbox names and an authorized directory through the hosted client. Verify the profile identity and domain. Record counts/status only in public handoff notes. If no profile is present, inspect the owner's hosting workspace/import state rather than silently copying or overwriting credentials.
5. Repeat hosted reads after a supported client restart and refresh. Only then mark hosted integration installed and verified.

## Recovery and upgrades

For a timeout, rerun login; preserve hosting profiles and encryption keys. For an expired grant, reauthorize the individual client. Restore Codex configuration from the private backup only if needed and reconcile unrelated later edits. The stable PostgreSQL encryption key and database must be backed up together through the existing hosting recovery process; this Windows task did not access or change either. Do not reset production identity or enable inbound RDP/SSH/remoting to solve login.

Before upgrading, inspect the new tag, main SHA, release notes and Node requirements. Review a branch/PR for code changes, preserve user configuration and credentials, install a newer private plugin using its supported release process, and repeat the anonymous probe plus authenticated reads. No server restart or production redeployment was performed during this verification.
