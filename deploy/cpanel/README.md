# Deploy on cPanel / CloudLinux / Passenger

Use this route only if your hosting plan provides Node.js **22.19 or later**, a supported Node application manager/Passenger, PostgreSQL, an HTTPS hostname and SMTP or working local sendmail. cPanel branding alone does not establish that these services are included. Use your own account, domain and credentials.

## Build and install

1. From the source checkout, run `npm ci`, `npm run build` and the relevant validation scripts. `python scripts/build-cpanel.py` creates the cPanel runtime ZIP; use the exact output path printed by the builder.
2. Create a dedicated PostgreSQL database and user with access to that database.
3. Create a connector hostname with its own document root. Keep the application directory and private configuration outside public web roots.
4. In the host's **Setup Node.js App** interface, choose a supported Node version, production mode, the connector URL and startup file `app.js`.
5. Extract the runtime ZIP into the application directory and install its production dependencies using the hosting manager. Do not copy a Windows `node_modules` directory onto Linux.

The package root is CommonJS for Passenger's startup loader; compiled files under `dist` are ESM. Startup must run when Passenger requires `app.js` as a module.

## Private configuration

Copy `runtime.example.json` to a private input file. Replace every example value with your own settings. From the full source checkout, initialize the final runtime once:

```sh
node scripts/init-hosted-config.mjs --input /absolute/private/input.json --output /absolute/private/runtime.json
```

The parent directory must be private (`0700` on Linux); configuration files must be owner-readable only (`0600`). The initializer creates the encryption key once and refuses to overwrite an existing output. Configure the Node application's `PARMTECH_CONFIG_FILE` environment variable with that absolute runtime path. Keep the input and final configuration out of Git and public archives.

The runtime needs the public HTTPS origin, database connection, `SETUP_OWNER_EMAIL`, registration allowlist, mail delivery and a stable credential encryption key. Trust proxy headers only when the actual proxy overwrites them correctly. The startup loader preserves Passenger's runtime `PORT` and fails when required configuration is invalid.

Back up PostgreSQL and the original key/private runtime independently of the replaceable app. Losing the original key makes existing encrypted profiles unreadable. The operator can decrypt saved hosting credentials.

## Start and verify

Restart through the hosting manager. Check `/health` and `/.well-known/oauth-authorization-server`, then open `/mani_admin`. Complete the email verification wizard, choose a new connector password, and add your own hosting profile. Connect an MCP client with the [client guide](../../docs/CLIENT-SETUP.md) and verify an authenticated read-only hosting operation.

A managed host can idle/restart the Node process. Persistent profiles and OAuth state live in PostgreSQL; upload staging is temporary. Check the host's request-body, disk and execution limits before relying on large transfers. A computer running the AI client need not stay on to keep this hosted endpoint available.

## Browser file transfers

The signed-in `/mani_admin/uploads` page supports staged file uploads. Browser chunks may be up to 8 MiB; the total limit is 1,000,000,000 bytes with a six-hour staging lifetime. Proxy limits must allow an individual chunk and sufficient total disk space. These application limits do not override cPanel's own limits.

`PRIVATE_UPLOAD_DIR` and `PRIVATE_PLAY_BUNDLE_DIR` can override staging with absolute private writable directories. Keep them outside web roots and deployment archives. The cPanel upload default is `.private-uploads` under the application directory; preserve it during an update only when continuing an unexpired transfer.

Direct browser downloads require the connector and target cPanel account to share the **same server filesystem**. They are disabled by default. An operator can privately configure all three values:

| Setting | Your value |
| --- | --- |
| `LOCAL_DOWNLOAD_ROOT` | Absolute filesystem directory whose files may be downloaded |
| `LOCAL_DOWNLOAD_CPANEL_HOST` | Your cPanel hostname, without a scheme or port |
| `LOCAL_DOWNLOAD_CPANEL_USERNAME` | The cPanel account owning that directory |

These values bind downloads to a matching saved cPanel profile and a confined filesystem root. Do not configure them for a remote cPanel server or use another user's home directory. Leave them unset when that deployment arrangement does not apply. Consult [the transfer reference](../../docs/CPANEL-CAPABILITY-AUDIT.md) for limits.

## Certificates

Prefer your hosting provider's supported automatic certificate mechanism. If you use the included DNS-01 maintenance scripts, supply your own authoritative cPanel zone and private maintenance credential, and follow [the certificate section](../../docs/COMPLETE-GUIDE.md#10-lets-encrypt-and-renewal). The scripts are optional; no existing installation's renewal job is part of the public source configuration.

## Updates and rollback

Back up the database and private runtime, retain the previous application package, replace only app files, install matching dependencies, then restart through the hosting manager. Verify login, existing profiles and a read-only tool call. Refresh client tool metadata when tool definitions changed. Never delete the database or regenerate the encryption key as an update step.

Optional owner-import migration is disabled in public examples. If an operator configures it, its durable receipt must be preserved so an intentionally disconnected account is not imported again. Public packages never contain a saved hosting credential or migration receipt.

This source version has no automated password recovery or credential-key rotation. Run one app instance while rate limits are process-local. Your own deployment's email, OAuth, cPanel and WHM behavior must be verified; example configuration is not acceptance evidence.
