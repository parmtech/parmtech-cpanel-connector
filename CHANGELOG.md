# Changelog

## 0.2.0-alpha.4 — 25 November 2026

- Reconcile the public TypeScript source with the deployed connector's OAuth scope challenges, IPv6 rate limiting and persistent session renewal.
- Bring the existing GitHub and Play Console integrations into the main source tree, including verified binary AAB upload support.
- Include the deployed resumable cPanel upload workflow: files up to 1 GB, six-hour staging, browser chunks and private per-user staging.
- Replace deployment-specific direct-download paths and hosting identity with optional operator configuration; keep private credentials outside source and distributions.
- Keep Docker's application filesystem read-only while placing temporary transfer staging in explicitly configured writable directories.
- Align source, package, plugin and MCP version metadata; strengthen distribution privacy checks and regression coverage.
- Update independent self-hosting and client guides for Codex surfaces, ChatGPT, Claude, VS Code, Cursor and compatible MCP clients, with documented verification limits.

The private app-wrapper version is separate from this public source version. The password-recovery/key-rotation development branch is not part of this source reconciliation.

## 0.2.0-alpha.3 — 13 November 2026

- Standardize connector setup, profile verification, interface copy and current documentation in English.
- Add branded HTML verification emails with a plain-text alternative.
- Redesign hosted setup, login, consent and hosting-profile screens with a responsive workspace, clear forms and accessible focus states.
- Share the updated design with the local setup interface without changing its loopback security checks.
- Add presentation, escaping and English-language regression checks. Existing credentials, encryption keys and database state are preserved.

## 0.2.0-alpha.2 — 13 November 2026

- Add verified first-admin setup with installer-pinned email, browser binding,15minute codes, five wrong attempts, three sends per15minutes and atomic one-admin completion.
- Use lowercase `/mani_admin` for setup/login/settings; redirect the connector root to the configured official website while preserving OAuth/MCP protocol routes.
- Add persistent private cPanel configuration, managed Passenger startup, bounded PostgreSQL connections and idle-connection recovery handling.
- Add verified-owner one-time migration with an intentional-disconnect receipt.
- Deploy owner-only hosting with Let’s Encrypt and daily server-side renewal; no Windows runtime dependency for hosted serving.
- Add full installation/use/security/publication documentation, source distribution builder, cPanel runtime package and checksums. Private production state is excluded.

Public hosted signup, password recovery, independent public-release review and directory approval are not claimed complete.

Source publication repository: https://github.com/parmtech/parmtech-cpanel-connector. Public hosted signup and ChatGPT directory approval remain separate from source distribution.
