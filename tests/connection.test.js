const { test } = require('node:test');
const assert = require('node:assert/strict');
const secretPath = require.resolve('../config/secret');
const getUri = require('../config/connection');
function run(config, env, fn) {
  const previous = require.cache[secretPath], mongo = process.env.MONGO_URI, flag = process.env.USE_ENV_MONGO_URI, pass = process.env.DB_PASSWORD;
  require.cache[secretPath] = { id: secretPath, filename: secretPath, loaded: true, exports: config };
  process.env.MONGO_URI = env.uri || ''; process.env.USE_ENV_MONGO_URI = env.flag || ''; process.env.DB_PASSWORD = 'unused-incorrect-password';
  try { fn(); } finally {
    if (previous) require.cache[secretPath] = previous; else delete require.cache[secretPath];
    for (const [key, value] of [['MONGO_URI', mongo], ['USE_ENV_MONGO_URI', flag], ['DB_PASSWORD', pass]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
test('legacy string/object password configuration ignores previously unused environment connection values', () => {
  for (const config of ['synthetic-test-db-password', { DB_PASSWORD: 'synthetic-test-db-password' }]) {
    run(config, { uri: 'mongodb+srv://unused.invalid/test' }, () => {
      const uri = getUri();
      assert.ok(uri.includes('synthetic-test-db-password'));
      assert.ok(!uri.includes('unused.invalid')); assert.ok(!uri.includes('unused-incorrect-password'));
    });
  }
});
test('environment MongoDB URI is used only after explicit opt-in; empty override fails', () => {
  run({}, { uri: 'mongodb://explicit.example.test/db', flag: 'true' }, () => assert.equal(getUri(), 'mongodb://explicit.example.test/db'));
  run({}, { flag: 'true' }, () => assert.throws(getUri, /requires MONGO_URI/));
});
