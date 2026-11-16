// Local checks by default. --database performs read-only checks against the configured DB.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
let failed = false;
const check = (ok, label) => { console.log(`${ok ? 'OK' : 'FAIL'}: ${label}`); if (!ok) failed = true; };
const real = value => typeof value === 'string' && value.length > 0 && !/^(replace-|your-)/i.test(value);
async function main() {
  check(Number(process.versions.node.split('.')[0]) >= 18, 'Node.js >= 18; release tested on 22.14.0');
  const secretFile = path.join(__dirname, '../config/secret.js');
  check(fs.existsSync(secretFile), 'config/secret.js exists (not supplied in release)');
  if (!fs.existsSync(secretFile)) return;
  const config = require(secretFile);
  const authKey = process.env.AUTH_TOKEN_SECRET || config.AUTH_TOKEN_SECRET;
  check(real(process.env.ADMIN_PASSWORD || config.ADMIN_PASSWORD), 'Admin password configured');
  check(real(authKey) && authKey.length >= 16, 'Session signing key configured');
  const vpnKey = process.env.COMMERCE_CREDENTIAL_KEY || authKey;
  check(real(vpnKey) && vpnKey.length >= 16, 'VPN encryption key configured');
  check(process.env.USE_ENV_MONGO_URI === 'true' ? real(process.env.MONGO_URI) : real(typeof config === 'string' ? config : config.DB_PASSWORD), 'Database connection configured');
  if (process.env.MONGO_URI && process.env.USE_ENV_MONGO_URI !== 'true') console.log('INFO: legacy database address is used; unused MONGO_URI is ignored. USE_ENV_MONGO_URI=true explicitly opts in.');
  for (const dependency of ['mongoose', 'express', 'dotenv', 'cors', 'nodemailer', 'body-parser']) {
    try { require.resolve(dependency); check(true, `${dependency} installed`); } catch (_) { check(false, `${dependency} missing; run npm ci --omit=dev`); }
  }
  if (!process.argv.includes('--database')) {
    console.log('Database NOT contacted. On the hosting run: node scripts/check-deployment.cjs --database');
    return;
  }
  if (failed) return;
  const mongoose = require('mongoose');
  try {
    await mongoose.connect(require('../config/connection')(), { serverSelectionTimeoutMS: 12000, autoIndex: false, autoCreate: false });
    check(true, 'MongoDB reachable');
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 }).catch(() => admin.command({ isMaster: 1 }));
    check(Boolean(hello.setName || hello.msg === 'isdbgrid'), 'Replica set / sharded MongoDB supports transactions');
    const sample = await mongoose.connection.db.collection('commerceassets').findOne({ credentials: { $exists: true } }, { projection: { credentials: 1 } });
    if (sample) {
      try { require('../commerce/credentials').credentialStore().decrypt(sample.credentials); check(true, 'Existing encrypted VPN credential readable with configured key'); }
      catch (_) { check(false, 'VPN key cannot decrypt existing data. Restore the original key; do not replace credentials'); }
    } else console.log('INFO: no encrypted VPN accounts yet; preserve the configured key after the first purchase.');
    console.log('Read-only DB checks finished. No collections, indexes, documents or transactions were written.');
    console.log('Write permissions and real transaction commits still require a staging smoke test.');
  } catch (_) { check(false, 'MongoDB check failed. Verify connection, network access and permissions; credentials are not printed.'); }
  finally { await mongoose.disconnect(); }
}
main().catch(() => { check(false, 'Configuration could not be loaded; inspect the configuration file on the server.'); }).finally(() => { process.exitCode = failed ? 1 : 0; });
