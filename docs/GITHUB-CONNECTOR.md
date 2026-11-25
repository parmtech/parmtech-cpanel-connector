# PARMTECH GitHub Connector

Optional remote MCP resource hosted by your own connector deployment. GitHub
has a separate resource URL, OAuth issuer, scopes, encrypted credentials, and
consent flow. A cPanel access token cannot authenticate to the GitHub resource.
The existing administrator login is reused.

Replace `connector.example.com` with your own HTTPS origin.

## One-time GitHub authorization

1. Open `https://connector.example.com/mani_admin/github` and sign in using your
   existing connector administrator login.
2. Register an OAuth App in your own GitHub account:
   - Name: **PARMTECH GitHub Connector**
   - Homepage: `https://connector.example.com`
   - Callback: `https://connector.example.com/github/callback`
3. Enter the application's Client ID and Client secret into the private settings
   page. Never put credentials in chat, a plugin archive or a repository.
4. Choose **Authorize on GitHub** and review GitHub's permissions page. GitHub's
   account roles, organization restrictions, SSO policies and endpoint-specific
   permissions still apply. Declined permissions are not bypassed.
5. In normal ChatGPT's Plugins directory, use **Add custom MCP server**:
   `https://connector.example.com/github/mcp`, OAuth authentication. Complete the
   consent page and verify the connected GitHub identity before making changes.

## Tools

- `github_connection_status`: account and authorized scope metadata, no secrets.
- `github_api_read`: GET requests against the GitHub REST API, with pagination.
- `github_api_write`: POST/PUT/PATCH/DELETE requests for broad administration.
- `github_create_repository`: private by default; personal and organization repos.
- `github_update_repository`: visibility and other supported repository settings.
- `github_put_file`: create/update UTF-8 content, including workflows when allowed.
- `github_graphql`: queries and mutations; always treated as a write-capable tool.

Runners can be registered, listed and managed using GitHub's Actions endpoints.
A self-hosted runner also needs an actual machine and runner installation; the
connector does not turn shared hosting into a build runner. Binary release
uploads and endpoints on other GitHub domains are not implemented by this JSON
REST transport. GitHub UI-only operations are not automatically available.

## Privacy and runtime behavior

OAuth application secrets and upstream access/refresh tokens are encrypted in
PostgreSQL using authenticated encryption bound to their user. MCP clients receive
PARMTECH's scoped tokens, never GitHub credentials. GitHub responses are bounded,
redirects are rejected, requests stay on `api.github.com`, and write requests are
not retried automatically. Expiring upstream grants refresh with a per-account
database lock. Errors do not dump credentials or raw internal server failures.

Use your own OAuth application and account. Public source distribution includes no GitHub credentials; your hosted service and its access policy remain under your control.

## Validation

`npm test` includes GitHub MCP discovery and tool execution with fixture transport,
read/write scope isolation, private creation defaults, exact REST methods,
credential redaction, upstream permission errors, OAuth discovery, and rejection
of cPanel grants/transactions at the GitHub endpoint. These tests do not create a
live repository. Verify live GitHub access using your own account after authorization. Successful fixture tests do not establish your upstream permissions.
