# Connect your MCP client

Use **your own connector URL and your own hosting account**. Every URL in this guide uses the reserved example domain `connector.example.com`; replace it with the HTTPS origin of the server you deployed. A repository download does not create a hosted account or install a ChatGPT plugin.

Client documentation was checked on **25 November 2026**. The configuration examples below match the linked official client documentation and the connector's source. They are not a claim that every client completed a live login and hosting operation. Verify each installation using the final section.

## Choose the correct connection

| Client or surface | Connection to use | Where to configure it |
| --- | --- | --- |
| Codex CLI | Local stdio or remote Streamable HTTP with OAuth | `codex mcp` / the local Codex configuration |
| Codex IDE extension | Same local Codex host configuration | Configure the host where the extension runs |
| Codex in a supported desktop app | Local stdio or remote HTTP | MCP server settings or the shared local Codex configuration |
| ChatGPT web / hosted Work | Remote MCP plugin with OAuth | Plugins; account and workspace policy apply |
| Codex Cloud | Only tools actually enabled for that cloud environment | Check the selected environment and its available plugins/tools; local configuration is not proof of cloud access |
| Claude Code | Local stdio or remote HTTP | `claude mcp` |
| Claude / Claude Desktop remote connector | Remote HTTP with OAuth | Customize → Connectors; workspace permissions apply |
| VS Code editor-managed MCP | Local stdio or remote HTTP | `.vscode/mcp.json`, or the editor's MCP settings |
| Cursor desktop | Local stdio or remote HTTP | `.cursor/mcp.json` or `~/.cursor/mcp.json` |

Desktop applications can offer both a local MCP mechanism and an account-hosted connector mechanism. Select the path described below; the mechanisms have different configuration and network reachability.

## 1. Prepare your hosting connection once

For the remote route, finish [self-hosting](SELF-HOSTING.md#option-b-host-your-own-remote-connector), then open `https://connector.example.com/mani_admin` and add your cPanel or WHM profile. For a local cPanel-only route, complete [local setup](SELF-HOSTING.md#option-a-run-locally).

The hosting token belongs in your connector's private setup form or hidden local prompt. The MCP client uses the connector's OAuth login; **do not enter a cPanel API token as an OAuth client secret or bearer token**.

| Purpose | Remote URL |
| --- | --- |
| Browser login and saved hosting profiles | `https://connector.example.com/mani_admin` |
| cPanel and WHM tools | `https://connector.example.com/mcp` |
| Optional GitHub tools | `https://connector.example.com/github/mcp` |
| Optional Google Play tools | `https://connector.example.com/play/mcp` |

The three MCP resources have separate grants. Start with `/mcp`; configure the other resources only when you need them and have completed their upstream setup.

## 2. Codex CLI, IDE extension and desktop

### Remote server

Run these commands on the computer or remote host that runs your Codex client:

```sh
codex mcp add my_hosting --url https://connector.example.com/mcp
codex mcp login my_hosting --scopes accounts:read,cpanel:read,offline_access
codex mcp list
```

If `add` already starts authorization, finish that browser flow. The explicit `login` command selects the listed scopes. Sign in to your connector, review consent, and return to Codex. Use `/mcp` inside its terminal UI to inspect the connection.

The equivalent remote configuration is:

```toml
[mcp_servers.my_hosting]
url = "https://connector.example.com/mcp"
scopes = ["accounts:read", "cpanel:read", "offline_access"]
```

Codex uses `~/.codex/config.toml`; trusted projects can use `.codex/config.toml`. Supported desktop and IDE clients share configuration **on the same Codex host**. A remote IDE host or another computer needs its own configuration and authorization. In the desktop MCP settings, choose **Streamable HTTP**, enter the URL, save/restart, and authenticate when prompted. [Official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Local cPanel server

Build the repository and save your cPanel token using `npm run setup`. Then give Codex the absolute path to `dist/src/index.js`:

```sh
codex mcp add my_hosting_local -- node /absolute/path/parmtech-cpanel-connector/dist/src/index.js
```

On Windows PowerShell, from the built repository:

```powershell
$connectorEntry = (Resolve-Path .\dist\src\index.js).Path
codex mcp add my_hosting_local -- node $connectorEntry
```

The client launches the process. Run setup and Codex as the same operating-system user with access to the credential store. Local mode has no hosted OAuth account and does not support WHM profiles.

## 3. ChatGPT web and hosted Work

In the current Plugins interface:

1. Open **Plugins**, select **+**, then **Add custom MCP server**.
2. Supply a name and your full `https://connector.example.com/mcp` endpoint.
3. Choose OAuth. Use automatic client registration when offered; this server implements public-client Dynamic Client Registration and PKCE. Do not supply your hosting token in these fields.
4. Review the server's risk acknowledgement, create the plugin, and complete connector sign-in and consent.
5. Review the discovered tools, enable the plugin, and select or mention it in a new conversation for the read-only verification below.

The current Plugins flow does not require enabling Developer Mode first. Available controls and read/write permissions depend on your account and workspace. A user without the custom-server option needs the workspace administrator's supported setup path. [Official ChatGPT connection instructions](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

After the server's tools change, use **Refresh** on the custom connection and start a new conversation. This is separate from updating a published plugin. [Official connection and testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

### Cloud tasks and local configuration

ChatGPT web does not read your computer's `~/.codex/config.toml`. Installing a local stdio server or attaching a GitHub repository does not establish cloud MCP access. For hosted Work, use the remote plugin route. For Codex Cloud, check the selected environment's available tools and run the read-only verification there. This project does not promise automatic local-to-cloud propagation or support in every legacy cloud surface. [Official MCP surface guidance](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## 4. Claude Code

For a remote server:

```sh
claude mcp add --transport http --scope user my_hosting https://connector.example.com/mcp
claude mcp login my_hosting
claude mcp list
```

Alternatively, start Claude Code and use `/mcp` to authenticate. For a local setup, after building and saving your token:

```sh
claude mcp add --transport stdio --scope user my_hosting_local -- node /absolute/path/parmtech-cpanel-connector/dist/src/index.js
```

Use a current client; confirm flags with `claude mcp --help` if your installed version differs. Project-scoped connections use `.mcp.json` and have separate trust decisions. [Official Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

## 5. Claude and Claude Desktop remote connectors

Open **Customize → Connectors → Add → Add custom connector**, enter your `/mcp` HTTPS URL, and choose OAuth sign-in. When asked for the OAuth client method, choose **Register automatically** for this server's DCR implementation. Complete connector login and consent. Team/workspace administrators may need to add the connector before members can connect their own accounts.

This remote connector is contacted from Anthropic's infrastructure, including when used through Claude Desktop. Use a reachable HTTPS endpoint on port 443. Desktop's local `claude_desktop_config.json` mechanism is separate. [Official remote-connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

For local stdio, a standard `mcpServers` entry points to the built program:

```json
{
  "mcpServers": {
    "my_hosting_local": {
      "command": "node",
      "args": ["/absolute/path/parmtech-cpanel-connector/dist/src/index.js"]
    }
  }
}
```

Use your actual absolute path; JSON Windows paths need escaped backslashes. The token remains in the same operating-system user's credential store. Restart the local client after editing its configuration. This local path is configuration guidance, not a verified Desktop session.

## 6. VS Code editor-managed MCP

For the editor's MCP client, add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "my_hosting": {
      "type": "http",
      "url": "https://connector.example.com/mcp"
    }
  }
}
```

Start the server from the editor's MCP controls, review trust, and follow OAuth authentication. This is the **editor-managed** format; other agent harnesses can use different files. The Codex IDE extension uses the Codex instructions above. [Official VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## 7. Cursor desktop

Create `.cursor/mcp.json` for one project or `~/.cursor/mcp.json` for your user:

```json
{
  "mcpServers": {
    "my_hosting": {
      "url": "https://connector.example.com/mcp"
    }
  }
}
```

Enable the connection in Cursor and complete OAuth. Cursor supports Streamable HTTP and DCR. Its hosted Cloud Agents have a separate server configuration; they do not read your local user file. [Official Cursor MCP guide](https://cursor.com/docs/mcp).

## 8. Verify the connection and permissions

Successful installation, server health, OAuth sign-in and a successful hosting API call are separate checks:

1. Confirm the client discovers the hosting tools and shows an authenticated connection.
2. Ask: **“List my connected hosting profiles.”** Match the returned label and host to your intended account.
3. For cPanel, ask: **“List domains on that cPanel account.”** For WHM, use `whm_api_read` with `version` after granting `whm:read`.
4. A populated account list confirms saved profiles; only the hosting API result confirms the upstream credential works. An empty list means you still need to add a profile.

For changes, authorize the relevant scope and inspect the requested operation. `cpanel_uapi_execute`, `cpanel_api2_execute` and `whm_api_execute` are broad tools requiring write grants even when a particular requested function reads data. Dedicated listing tools and `whm_api_read` are the read-only starting point. `accounts:write` permits removing a saved connector connection; it is unnecessary for ordinary listings.

`offline_access` enables refresh grants. An expired connector authorization does not by itself mean your cPanel token was deleted. Reauthenticate the client; revoke or replace the hosting credential separately only when needed.

### Verification record

| Check | What this documentation establishes |
| --- | --- |
| Repository setup commands and entrypoint paths | Matched to current source; Codex `add`, `login` and `list` command availability inspected locally |
| Client configuration formats | Reviewed against the official documentation linked above on 25 November 2026 |
| Your server deployment and email delivery | Must be verified on your deployment |
| Fresh OAuth login in each client | Must be verified in each client you use |
| cPanel and WHM API access | Must be verified against your own account and token permissions |
| General public hosted service or directory approval | Not established by publishing this source |

## Troubleshooting

- **Browser shows an error at `/mcp`:** open `/mani_admin` for the human login; `/mcp` is a protocol endpoint.
- **403 / insufficient scope:** reconnect with the needed connector scope, then check the upstream token's permissions. Do not disable authorization.
- **Redirect or login expires:** start a fresh client login and finish it in the same browser session.
- **Local server works but cloud tools are missing:** configure the hosted plugin separately and check workspace policy.
- **Token validation fails:** confirm the actual cPanel/WHM hostname, account type, TLS certificate, token expiry and allowed API access. Hosted mode rejects private/loopback hosting destinations.
- **No credential store:** local setup requires a working OS keyring; on headless hosts use a suitable remote deployment instead of putting secrets in client JSON.

See [self-hosting troubleshooting](SELF-HOSTING.md#troubleshooting-and-limits) for server configuration and recovery limits.
