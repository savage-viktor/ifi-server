const { test } = require('node:test');
const assert = require('node:assert/strict');

test('hosting entry point starts when loaded via require, without touching the real database', () => {
  const appPath = require.resolve('../app');
  const dbPath = require.resolve('../config/db');
  let listened = false;
  const originalApp = require.cache[appPath];
  const originalDb = require.cache[dbPath];
  const serverPath = require.resolve('../server');
  require.cache[appPath] = { id: appPath, filename: appPath, loaded: true, exports: { listen(port) {
    assert.equal(port, process.env.PORT || 3000);
    listened = true;
  } } };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
  try {
    require('../server');
    assert.equal(listened, true);
  } finally {
    delete require.cache[serverPath];
    if (originalApp) require.cache[appPath] = originalApp; else delete require.cache[appPath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
  }
});
