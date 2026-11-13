# Quick start

## Create your administrator login

Open **https://connector.parmtech.au/mani_admin** for the PARMTECH installation, or your own connector host followed by `/mani_admin`.

On the first visit, enter the owner email configured during installation. The PARMTECH owner's configured address is **info@parmtech.au**. Select **Send verification code**. Keep that browser tab open, retrieve the eight-digit code from your email and enter it with your chosen password and confirmation.

There is no default password. After first-time setup, use the same email and your chosen password to sign in. This connector login is separate from your cPanel, mailbox and ChatGPT credentials.

Codes expire after 15 minutes. Five incorrect attempts exhaust a code. You can request up to three codes per 15 minutes. Complete verification in the browser where you started setup. Never put a password or verification code into chat.

## Add a hosting connection

In the workspace, add a label, server hostname, hosting username, account type and API token or supported hosting password. The token value is different from its optional name. Saved secrets are validated and encrypted, and are not displayed again.

The PARMTECH installation has an optional one-time migration for its verified owner. Self-hosting users never receive PARMTECH credentials. Intentionally disconnected profiles are not silently re-created.

## Connect your client

Use the remote MCP endpoint `https://connector.parmtech.au/mcp` for the owner installation, or your own `/mcp` endpoint. Select OAuth in a compatible client, sign in and review the requested permissions. The `/mcp` URL is a protocol endpoint, not a browser login page.

The hosted service runs independently of your Windows PC. Client sign-in expiration and removal of a saved cPanel credential are separate events. The original local plugin does not switch to the hosted server automatically.

## Find everything in the ZIP

Open **START-HERE.html** for the complete English guide. The ZIP includes source, tests, configuration templates and server/plugin packages. It does not include real production passwords, API tokens, database backups or SSL private keys.

The current hosted endpoint is owner-restricted. Other users can self-host the MIT-licensed source using their own hosting, domain, database, email and credentials. Publishing source on GitHub does not create a public ChatGPT directory listing.
