'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadConfiguration(filename, appRoot = __dirname, environment = process.env) {
  if (!filename || !path.isAbsolute(filename)) throw new Error('Set PARMTECH_CONFIG_FILE to an absolute private configuration file.');
  const real = fs.realpathSync(filename);
  const root = fs.realpathSync(appRoot);
  const relative = path.relative(root, real);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Keep configuration outside the deployed application directory.');
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > 32768) throw new Error('Private configuration is invalid.');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Private configuration must have owner-only permissions (0600).');
  const config = JSON.parse(fs.readFileSync(real, 'utf8'));
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Private configuration must be an object.');
  for (const key of ['PUBLIC_BASE_URL', 'CREDENTIAL_ENCRYPTION_KEY', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error('Private configuration is incomplete.');
  }
  if (Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('Private encryption key must be 32 bytes.');
  // Persistent configuration owns credentials. Passenger owns its runtime PORT.
  const allowed = new Set(['PUBLIC_BASE_URL','CREDENTIAL_ENCRYPTION_KEY','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PG_SSL','TRUST_PROXY','SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_REQUIRE_TLS','SMTP_USER','SMTP_PASSWORD','MAIL_FROM','MAIL_TRANSPORT','REGISTRATION_ALLOWED_EMAILS','OWNER_CONNECTION_IMPORT_FILE','OWNER_CONNECTION_EMAIL','SETUP_OWNER_EMAIL','COMPANY_SITE_URL','CPANEL_DNS_ZONE']);
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.has(key) || typeof value !== 'string') throw new Error('Unexpected private configuration setting.');
    environment[key] = value;
  }
  environment.NODE_ENV = 'production';
}

module.exports = { loadConfiguration };
