# Offline account credential key rotation

This procedure rotates **database account envelopes only**. It requires a maintenance window, a tested database backup and secure access to both keys. The app must remain stopped until the database and configuration use the same key. A failed or interrupted cutover can otherwise make profiles unreadable.

**Do not use this procedure while external encrypted envelopes still depend on the same key.** cPanel deployments can use `ssl-auth.enc` for certificate renewal and `OWNER_CONNECTION_IMPORT_FILE` for owner migration; those files use this key too. This tool does not migrate them. First plan and verify a separate safe re-encryption or replacement of every such file, or keep using the old key. Do not delete the original files or key. If you cannot identify every dependent envelope, do not rotate. This limitation is particularly relevant to the PARMTECH owner deployment.

1. On a test copy, rehearse backup, rotation and restoration first. Schedule downtime. Stop all app instances, automatic restarts, renewal jobs and other database writers. Confirm they stay stopped. An exclusive table lock is not a substitute for stopping them.
2. Back up the database, the original configuration/key and all external encrypted files. Store backups separately and securely, and verify that they can be restored together. Keep the old key for old backups.
3. Put the existing base64 encryption key in an owner-only private file outside the repository, and create a different key file. For example, on a Linux host with OpenSSL:

   ```sh
   umask 077
   openssl rand -base64 32 > /private/new-account-key
   chmod 600 /private/old-account-key /private/new-account-key
   ```

   Populate `/private/old-account-key` privately from the existing configuration; do not put it in shell history or print it. Each file must contain only one canonical 32-byte base64 key. Substitute real absolute paths.
4. On the deployment host, install dependencies and build this exact revision. Set PostgreSQL connection variables privately (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PG_SSL=true` if appropriate). Confirm they target the intended database. Never paste connection strings or credentials into chat.
5. After all external envelope dependencies are handled and all processes stopped, run:

   ```sh
   node dist/scripts/rotate-account-key.js --offline-no-external-envelopes --keys /private/old-account-key /private/new-account-key
   ```

   The tool locks the accounts table and re-encrypts each profile with its existing authenticated context in one database transaction. A bad old key causes a rollback. It does not update application configuration or external files. The flag records the operator's explicit assertion; the tool cannot detect every external dependency.
6. After a confirmed successful commit, privately set `CREDENTIAL_ENCRYPTION_KEY` in the deployment configuration to the new key and update any separately handled external envelopes. Start one app instance and verify access to every profile and any renewal/import dependency before returning it to service. Securely retain both keys with their corresponding backups.

If interrupted, or if the database connection fails around commit, **the outcome can be uncertain**. Keep all processes stopped. Determine which key decrypts the database on a disposable restored copy; if in doubt restore the matching database, configuration and external files from the verified pre-rotation backup. Do not rerun blindly or generate a replacement key. This tool cannot make the database transaction and separate configuration/file changes atomic.
