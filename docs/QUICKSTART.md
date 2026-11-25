# Quickstart: connect your own hosting

## 1. Choose an installation

For a new installation, follow [self-hosting or local setup](SELF-HOSTING.md). For an existing remote installation, use the HTTPS URL supplied by its operator. Examples below use `https://connector.example.com`; replace it with your own connector URL.

## 2. Sign in to the connector

Open `https://connector.example.com/mani_admin`. On the first installation, use the address configured in `SETUP_OWNER_EMAIL`, request its verification code, and keep the original browser tab open while you enter the code and choose a new connector password. There is no default password.

Later visits use that connector email/password. This login is separate from your cPanel account and your AI client's login. First-admin codes expire after 15 minutes and allow five incorrect attempts; a new request is subject to the setup rate limit.

## 3. Add your own cPanel or WHM account

Add a label, hosting server hostname, hosting username, access level and API token. Enter the token value in the masked form; its optional token name is a separate field. The connector validates the credential before encrypting and saving it. Use a dedicated token from your own hosting account. WHM access requires a WHM token and the corresponding privileges.

## 4. Connect your AI client

Use `https://connector.example.com/mcp` with OAuth. Complete connector sign-in and consent. Read the [client setup guide](CLIENT-SETUP.md) for Codex CLI, IDE/desktop, ChatGPT web/Work, cloud limitations, Claude, VS Code and Cursor.

For Codex:

```sh
codex mcp add my_hosting --url https://connector.example.com/mcp
codex mcp login my_hosting --scopes accounts:read,cpanel:read,offline_access
codex mcp list
```

## 5. Verify a read-only operation

Ask the client to list connected hosting profiles, confirm the intended label/host, then list that cPanel account's domains. For a WHM profile, grant `whm:read` and use `whm_api_read` with `version`.

A healthy endpoint or successful OAuth login alone does not prove that the hosting credential works. A returned hosting API result completes this check. Authorize write access only for changes you intend to make.

The source package includes code and public configuration examples. It contains no production credentials. The connector's public-source license and a hosted operator's signup policy are separate; another operator's account is not needed when you self-host.
