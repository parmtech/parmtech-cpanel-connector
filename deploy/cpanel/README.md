# Owner-only hosted connector

Deployed endpoint: https://connector.parmtech.au/mcp

The service is managed by Namecheap's CloudLinux Node.js selector/Passenger on Node22. The application is outside the public document root. A dedicated PostgreSQL database stores profiles, AES-GCM-encrypted cPanel credentials, hashed sessions and rotating OAuth grants. Windows is not involved in serving requests. Passenger may stop an idle process and start it for the next request; this is not a permanently running background converter.

## Persistent configuration

`PARMTECH_CONFIG_FILE` points to a private owner-only JSON file outside the replaceable application directory. It contains database credentials and the stable32-byte credential encryption key. The startup loader rejects missing/invalid configuration and never generates a replacement encryption key. Keep both database backups and the original key; replacing the key makes stored profiles unreadable. The operator can decrypt credentials and is not an operator-blind custodian.

`app.js` must start even when Passenger requires it as a module. Do not wrap its startup in `require.main === module`. The deployed package is CommonJS at its root with an ESM marker inside `dist`.

Build with `npm run build`, `node scripts/validate-cpanel.cjs`, `npx tsx scripts/validate-owner-import.ts` and `python scripts/build-cpanel.py`. The generated cPanel ZIP excludes credentials, source maps and Windows native keyring modules. Install production dependencies using the hosting selector, not a copied Windows node_modules directory. The generic Docker/PostgreSQL deployment remains a separate alternative.

## Owner onboarding

Registration is restricted to the configured owner email allowlist. Use `info@parmtech.au` for the staged owner migration. Create a connector profile with a new password, verify the email, then grant the requested OAuth scopes. No password/token belongs in chat.

The operator migration is bound to the configured, email-verified owner. It validates the existing saved cPanel credential and imports it into that owner's encrypted PostgreSQL profile. Other users and unverified profiles cannot import it. A private durable receipt prevents intentionally disconnected accounts from being recreated. The browser never receives the imported secret. First real owner migration and authenticated remote tool acceptance remain pending until browser authorization is completed.

## HTTPS and renewal

Let’s Encrypt DNS-01 issuance and cPanel SSL installation succeeded. TLS hostname validation and HTTP308 to HTTPS were checked. The initial certificate expires10February2027; daily renewal checks run on the hosting server and renew within30days of expiry. The real server check passed the fresh-certificate path. Renewal reuses its saved ACME account key and accesses cPanel through a separately AES-GCM-encrypted maintenance credential in the private operations directory. DNS changes are limited to the exact challenge TXT name/value; unrelated records are preserved. The maintenance process logs no secrets. Failure sends a Punjabi notification to the owner mailbox.

The hosting operations state/receipts are in the connector workspace's `work/hosted-connector-stage.json`, `work/connector-ssl-evidence.json` and `work/hosted-connector-http-evidence.json`. These contain no plaintext secret values. Private hosting runtime files and key material must never be put in a public ZIP or Git.

## Verified and pending

- TypeScript build, local stdio/HTTP/CSRF/origin tests and mock secret-redaction tests pass.
- Persistent configuration checks prove key reuse, no regeneration, private paths and runtime PORT preservation.
- Migration tests cover verified-owner isolation, validation, one-time import, explicit disconnect and authenticated encryption.
- Live HTTPS health/metadata succeed; unauthenticated MCP POST returns401; public client registration and PKCE authorization form succeed.
- Previously registered OAuth client remains usable after a managed app restart.
- First real owner login, email delivery, credential import and authenticated client tool call are not yet verified. Do not call that connection complete until they pass.

The saved Windows account was still readable during investigation. The existing chat plugin returned an invalid-UAPI-envelope error while the current compiled direct client successfully read cPanel. This is evidence of an outdated running parser, not proof that the cPanel token was erased. An old deployment helper also referenced a replaced account ID; it now resolves the exact saved host/username instead of a stale ID.


## First-admin update (alpha.2)

The canonical setup/login URL is `/mani_admin`. The bare hostname redirects to the configured official website. First setup sends a browser-bound eight-digit code to SETUP_OWNER_EMAIL, then lets the owner choose and confirm a new password. No shared/default password exists. PostgreSQL tests and live HTTP negative tests passed; actual owner email receipt and choosing the password remain owner acceptance steps. See docs/COMPLETE-GUIDE.md for the complete installation and use instructions. CloudLinux restart signalling retained an old running process during this rollout; the exact connector-owned Node process was terminated once, and Passenger then loaded the new version. No other application process was touched. Daily SSL renewal was restored after temporary tests.
