# Changelog

## 0.2.0-alpha.2 — 13 November 2026

- Add verified first-admin setup with installer-pinned email, browser binding,15minute codes, five wrong attempts, three sends per15minutes and atomic one-admin completion.
- Use lowercase `/mani_admin` for setup/login/settings; redirect the connector root to the configured official website while preserving OAuth/MCP protocol routes.
- Add persistent private cPanel configuration, managed Passenger startup, bounded PostgreSQL connections and idle-connection recovery handling.
- Add verified-owner one-time migration with an intentional-disconnect receipt.
- Deploy owner-only hosting with Let’s Encrypt and daily server-side renewal; no Windows runtime dependency for hosted serving.
- Add full installation/use/security/publication documentation, source distribution builder, cPanel runtime package and checksums. Private production state is excluded.

Public hosted signup, password recovery, independent public-release review and directory approval are not claimed complete.

Source publication repository: https://github.com/parmtech/parmtech-cpanel-connector. Public hosted signup and ChatGPT directory approval remain separate from source distribution.
