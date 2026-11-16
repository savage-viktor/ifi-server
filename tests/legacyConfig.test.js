const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_PASSWORD = 'synthetic-legacy-admin-password';
process.env.AUTH_TOKEN_SECRET = 'synthetic-legacy-signing-key';
const secretPath = require.resolve('../config/secret');
require.cache[secretPath] = { id: secretPath, filename: secretPath, loaded: true, exports: 'synthetic-legacy-db-password' };
const mailPath = require.resolve('nodemailer');
let transports = 0;
require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: { createTransport() { transports++; throw new Error('SMTP must not initialize without settings'); } } };
const ContactUs = require('../models/contactUsModel');
let saved = 0;
ContactUs.create = async body => { saved++; return { _id: 'saved-contact', ...body }; };
const app = require('../app');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/backend`; });
after(async () => { await new Promise(resolve => server.close(resolve)); });
test('full app starts with a legacy string secret and no EMAIL settings', async () => {
  const response = await fetch(base + '/');
  assert.equal(response.status, 401); assert.equal(transports, 0);
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
});
test('contact message remains saved when optional SMTP configuration is absent', async () => {
  const response = await fetch(base + '/contactUs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test', message: 'Synthetic message' }) });
  assert.equal(response.status, 201); assert.equal(saved, 1); assert.equal((await response.json())._id, 'saved-contact'); assert.equal(transports, 0);
});
