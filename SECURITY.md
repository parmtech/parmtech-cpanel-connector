# Security and deployment status

This is an owner-restricted alpha. Source distribution is not a public-service security certification. Report concerns privately through the operator's support channel; never publish hosting tokens or private configuration in an issue.

- First admin setup requires the installer-pinned email, a browser-bound expiring code and atomic database completion. There is no default admin password or unrestricted first-visitor admin claim.
- Passwords are scrypt hashes. Hosting credentials are AES-GCM encrypted and bound to user/account IDs. The operator holds the key and can decrypt them.
- Keys, database backups, cPanel credentials, SSL renewal credentials and owner-import receipts are private operational state, not source files.
- HTTPS is required in production; public outbound hosting requests are resolved/pinned to public addresses. Do not disable certificate verification.
- OAuth uses PKCE, resource binding, scopes, short-lived access grants and refresh rotation. Clients still control their own action approvals.
- cPanel/WHM write tools can be destructive. Grant only needed hosting/client permissions. A hidden admin URL is not the security boundary.
- Optional owner import is explicitly email-verified and single-use. It must not be enabled for unrelated users.

Public SaaS launch still needs independent review, password recovery, deployment-wide rate limiting for multiple instances, observability, backup/restore exercises and real multi-user/WHM acceptance. Process-local rate limiting is not a distributed abuse-control system. Do not present the current owner's private service as unrestricted public registration.
