'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {loadConfiguration} = require('./load-config.cjs');
// Passenger requires this file as a module, so do not gate on require.main.
try {
  loadConfiguration(process.env.PARMTECH_CONFIG_FILE, __dirname);
  import(pathToFileURL(path.join(__dirname,'dist/src/hosted/server.js')).href).catch(() => {
    console.error('Hosted connector startup failed; inspect private database/runtime configuration. Secrets are not logged.');
    process.exitCode=1;
  });
} catch {
  console.error('Hosted connector private configuration is missing or invalid. Existing keys were not changed.');
  process.exitCode=1;
}