const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = {
  ADMIN_PASSWORD: 'admin-test-password', ADMIN_TOKEN: 'postman-test-key', AUTH_TOKEN_SECRET: 'test-signing-key',
  EMAIL: { host: 'smtp.example.test', port: 465, secure: true, auth: { user: 'test', pass: 'test' }, from: 'from@example.test', to: 'to@example.test' },
  WORKERS: [
    { id: 'one', login: 'one', name: 'First', password: 'one-password' },
    { id: 'two', login: 'two', name: 'Second', password: 'two-password' },
  ],
};
process.env.ADMIN_PASSWORD = config.ADMIN_PASSWORD;
process.env.ADMIN_TOKEN = config.ADMIN_TOKEN;
process.env.AUTH_TOKEN_SECRET = config.AUTH_TOKEN_SECRET;
// Replace only local dependencies: no MongoDB connection or external requests.
const secretPath = require.resolve('../config/secret');
require.cache[secretPath] = { id: secretPath, filename: secretPath, loaded: true, exports: config };
const rows = [
  { _id: 'own', orderNumber: 1, status: 'open', createdBy: { role: 'worker', id: 'one' } },
  { _id: 'other', orderNumber: 2, status: 'open', createdBy: { role: 'worker', id: 'two' } },
  { _id: 'closed', orderNumber: 3, status: 'closed', createdBy: { role: 'worker', id: 'one' } },
  { _id: 'legacy', orderNumber: 4 },
];
const at = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
const matches = (row, query) => Object.entries(query).every(([key, value]) => (value && typeof value === 'object' && '$exists' in value ? (at(row, key) !== undefined) === value.$exists : at(row, key) === value));
function query(value) {
  return { then: (yes, no) => Promise.resolve(value).then(yes, no),
    limit() { return this; }, sort() { return this; }, lean() { return this; },
    select(fields) {
      if (fields === '-prices') return query(Array.isArray(value) ? value.map(({ prices, ...rest }) => rest) : (({ prices, ...rest }) => rest)(value));
      return this;
    },
  };
}
const Order = require('../models/orderModel');
let orderCounter = 2700000;
const { Counter } = require('../commerce/models');
Counter.updateOne = async (_, update) => { orderCounter = Math.max(orderCounter, update.$max.value); };
Counter.findOneAndUpdate = async () => ({ value: ++orderCounter });
Order.find = (filter = {}) => query(rows.filter(row => matches(row, filter)));
Order.findOne = filter => query(rows.find(row => matches(row, filter)) || null);
Order.create = async data => { const row = { _id: 'new-' + rows.length, ...data }; rows.push(row); return row; };
Order.findOneAndUpdate = async (filter, update) => { const row = rows.find(row => matches(row, filter)); if (row) Object.assign(row, update.$set); return row || null; };
Order.findByIdAndUpdate = async (id, update) => { const row = rows.find(row => row._id === id); if (row) Object.assign(row, update.$set); return row || null; };
const Service = require('../models/serviceModel');
const services = [{ name: 'Repair', prices: [{ amount: 123, clients: ['Іваненко Іван'] }] }];
Service.find = () => query(services);
Service.findById = () => query(services[0]);
require('../models/modelModel').find = () => query([]);
require('../models/componentModel').find = () => query([]);
const client = { _id: 'client1', firstName: 'Іван', lastName: 'Іваненко', login: 'client1', password: 'client-password' };
require('../models/clientModel').find = () => query([client]);
require('../models/clientModel').findOne = () => query(client);
require('../models/clientModel').findById = () => query(client);
services[0].toObject = () => ({ name: services[0].name, prices: services[0].prices });
services[0].prices.push({ amount: 999, clients: ['Інший Клієнт'] });
require('../models/contactUsModel').create = async () => null;
require('../models/legalControlModel').find = () => query([]);
const app = require('../app');
let server, base, admin, one, two;
async function request(path, token, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/backend`;
  admin = (await request('/auth/login', null, 'POST', { password: config.ADMIN_PASSWORD })).body.token;
  one = (await request('/worker/login', null, 'POST', { login: 'one', password: 'one-password' })).body.token;
  two = (await request('/worker/login', null, 'POST', { login: 'two', password: 'two-password' })).body.token;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
test('localhost login preflight succeeds before authentication', async () => {
  const response = await fetch(base + '/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.ok(response.headers.get('access-control-allow-methods').includes('POST'));
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
});
test('login rejects wrong credentials and accepts configured users and Postman key', async () => {
  assert.ok(admin && one && two);
  assert.equal((await request('/auth/login', null, 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await request('/auth/me', config.ADMIN_TOKEN)).status, 200);
  assert.equal((await request('/auth/me', one)).status, 403);
  assert.equal((await request('/orders', admin + 'tampered')).status, 401);
});
test('anonymous access is restricted across every registered protected route', async () => {
  const publicRoutes = new Set(['/backend/models', '/backend/models/:id', '/backend/contactUs', '/backend/legalControl']);
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    const { path, methods } = layer.route;
    if (path.includes('/client/') || path.endsWith('/login')) continue;
    for (const method of Object.keys(methods)) {
      if ((method === 'get' && ['/backend/models', '/backend/models/:id'].includes(path)) || (method === 'post' && publicRoutes.has(path) && path !== '/backend/models')) continue;
      const url = path.replace('/backend', '').replace(':id', 'own').replace(':uniqnum', '1234567890');
      assert.equal((await request(url || '/', null, method.toUpperCase(), ['get', 'head'].includes(method) ? undefined : {})).status, 401, `${method} ${path}`);
    }
  }
});
test('public website and legalControl endpoints remain accessible', async () => {
  assert.equal((await request('/models')).status, 200);
  assert.equal((await request('/contactUs', null, 'POST', {})).status, 404);
  assert.equal((await request('/legalControl')).status, 401);
  assert.equal((await request('/legalControl', one)).status, 403);
  assert.equal((await request('/legalControl', admin)).status, 200);
  assert.equal((await request('/legalControl', config.ADMIN_TOKEN)).status, 200);
  assert.equal((await request('/legalControl', null, 'POST', {})).status, 400);
  assert.equal((await request('/legalControl/1234567890/status', null, 'PUT', { deviceStatus: 'lock' })).status, 401);
});
test('worker catalogs are read only and services contain no prices', async () => {
  for (const path of ['/clients', '/components', '/services']) assert.equal((await request(path, one)).status, 200);
  assert.equal((await request('/clients', one)).body[0].password, undefined);
  assert.equal((await request('/services', one)).body[0].prices, undefined);
  assert.equal((await request('/services/id', one)).body.prices, undefined);
  assert.ok((await request('/services', admin)).body[0].prices);
  for (const path of ['/clients', '/models', '/components', '/services', '/tasks', '/paycontrols', '/legalControl/1234567890']) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      if (path.startsWith('/legalControl') && method === 'POST') continue;
      assert.equal((await request(path, one, method, {})).status, 403, `${method} ${path}`);
    }
  }
});
test('inventory, costs, purchases and transfers are administrator-only, including nested router paths', async () => {
  for (const path of ['/commerce', '/commerce/report', '/commerce/purchases', '/commerce/expenses', '/commerce/sales', '/commerce/transfers', '/commerce/purchases/example/payments', '/commerce/assets/example/credentials']) {
    for (const method of ['GET', 'POST']) {
      assert.equal((await request(path, null, method, method === 'POST' ? {} : undefined)).status, 401);
      assert.equal((await request(path, one, method, method === 'POST' ? {} : undefined)).status, 403);
    }
  }
});
test('ordinary form cannot replace stock sale lines or owner, and stock order cannot be deleted', async () => {
  rows.push({ _id: 'stock-sale', orderNumber: 999, commerce: { operationId: 'test-sale', costCents: 12345 },
    devices: [{ amount: '3000', model: 'Router' }], client: { lastName: 'Original' }, payments: [] });
  const result = await request('/orders/stock-sale', admin, 'PUT', { devices: [], client: { lastName: 'Forged' }, payments: [{ amount: '3000' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.devices.length, 1);
  assert.equal(result.body.client.lastName, 'Original');
  assert.equal(result.body.payments.length, 1);
  assert.equal((await request('/orders/stock-sale', admin, 'DELETE')).status, 409);
});
test('worker only sees their own open orders, including direct ID requests', async () => {
  assert.deepEqual((await request('/orders', one)).body.map(row => row._id), ['own']);
  assert.deepEqual((await request('/orders', two)).body.map(row => row._id), ['other']);
  for (const id of ['other', 'closed', 'legacy']) {
    assert.equal((await request('/orders/' + id, one)).status, 404);
    assert.equal((await request('/orders/' + id, one, 'PUT', { devices: [] })).status, 404);
  }
  assert.equal((await request('/orders/own', one, 'DELETE')).status, 403);
});
test('worker cannot forge ownership, change status or inject database operators', async () => {
  const created = await request('/orders', one, 'POST', { createdBy: { id: 'two' }, status: 'closed', closedAt: '2020-01-01', orderNumber: -1, devices: [] });
  assert.equal(created.status, 201);
  assert.equal(created.body.createdBy.id, 'one'); assert.equal(created.body.status, 'open');
  const edited = await request('/orders/own', one, 'PUT', { createdBy: { id: 'two' }, status: 'closed', $unset: { createdBy: 1 }, devices: [] });
  assert.equal(edited.body.createdBy.id, 'one'); assert.equal(edited.body.status, 'open');
  assert.equal((await request('/orders/own/status', one, 'PATCH', { status: 'closed' })).status, 403);
});
test('admin closes and reopens orders; worker access follows the current state', async () => {
  assert.equal((await request('/orders/own/status', admin, 'PATCH', { status: 'closed' })).body.status, 'closed');
  assert.equal((await request('/orders/own', one)).status, 404);
  assert.equal((await request('/orders/own', one, 'PUT', { devices: [] })).status, 404);
  assert.equal((await request('/orders/own', admin)).status, 200);
  assert.equal((await request('/orders/legacy', admin)).status, 200);
  const reopened = await request('/orders/own/status', admin, 'PATCH', { status: 'open' });
  assert.equal(reopened.body.closedAt, null);
  assert.equal((await request('/orders/own', one)).status, 200);
  assert.equal((await request('/orders/own/status', admin, 'PATCH', { status: 'invalid' })).status, 400);
});
test('client portal keeps its login and only returns prices belonging to the client', async () => {
  const login = await request('/client/login', null, 'POST', { login: 'client1', password: 'client-password' });
  assert.equal(login.status, 200);
  assert.equal(login.body.client.password, undefined);
  const prices = await request('/client/prices', login.body.token);
  assert.equal(prices.status, 200);
  assert.deepEqual(prices.body[0].prices.map(price => price.amount), [123]);
  assert.equal((await request('/client/me', login.body.token)).status, 200);
  assert.equal((await request('/client/orders', login.body.token)).status, 200);
  assert.equal((await request('/orders', login.body.token)).status, 401);
});
test('worker order endpoints write server prices and keep payment history administered separately', async () => {
  services.push({ name: 'Worker-priced', prices: [{ amount: 450, models: ['8800'], clients: [], dropshippers: [] }] });
  try {
    const created = await request('/orders', one, 'POST', {
      devices: [{ id: 'priced-device', model: '8800', service: 'Worker-priced', amount: '0' }], payments: [{ amount: '123' }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.devices[0].amount, '450');
    assert.deepEqual(created.body.payments, []);
    const record = rows.find(row => row._id === created.body._id);
    record.payments = [{ amount: '200' }];
    const edited = await request('/orders/' + record._id, one, 'PUT', {
      devices: [{ id: 'priced-device', model: '8800', service: 'Worker-priced', amount: '999' }], payments: [],
    });
    assert.equal(edited.body.devices[0].amount, '450');
    assert.deepEqual(edited.body.payments, [{ amount: '200' }]);
    const adminCreated = await request('/orders', admin, 'POST', { devices: [{ model: '8800', service: 'Worker-priced', amount: '777' }] });
    assert.equal(adminCreated.body.devices[0].amount, '777');
  } finally { services.pop(); }
});
