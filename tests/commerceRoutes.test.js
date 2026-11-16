const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCommerceRouter } = require('../commerce/routes');
const { memoryStore } = require('./helpers/commerceMemory');
let server, base;
const store = memoryStore();
// Exercise the production schema before the isolated adapter persists an order.
const ProductionOrder = require('../models/orderModel');
const createStoredOrder = store.Order.create;
store.Order.create = async data => {
  for (const order of Array.isArray(data) ? data : [data]) await new ProductionOrder(order).validate();
  return createStoredOrder(data);
};
store.credentialKey = () => 'test-credentials-key-for-http-tests';
const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = { id: 'test', name: 'Test admin' }; next(); });
app.use('/commerce', createCommerceRouter(store));
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/commerce`; });
after(async () => { await new Promise(resolve => server.close(resolve)); });
const buy = (serial, requestId = `purchase_${serial}`) => ({ requestId, supplier: 'Supplier', date: '2026-11-02', currency: 'USD', rate: 40,
  items: [{ kind: 'router', name: 'Router', serial, unitPrice: '50' }], payments: [] });
const sale = (assetId, id) => ({ requestId: id, date: '2026-11-02', client: { lastName: 'Клієнт' }, lines: [{ assetId, amount: '3000' }], services: [{ name: 'Налаштування', amount: '1500' }], payments: [{ amount: '4500', date: '2026-11-02', method: 'Готівка' }] });

test('purchase is idempotent and duplicate serial rolls back every row', async () => {
  const input = buy('serial_111');
  assert.equal((await request('/purchases', input)).status, 201);
  assert.equal((await request('/purchases', input)).status, 200);
  const before = store.tables();
  const duplicate = buy('serial_222'); duplicate.items.push(input.items[0]);
  assert.equal((await request('/purchases', duplicate)).status, 409);
  assert.deepEqual(store.tables(), before);
});
test('sale creates one compatible order with goods, service and one payment; retry never duplicates', async () => {
  const asset = store.tables().Asset[0], body = sale(asset._id, 'sale_request_111');
  const result = await request('/sales', body);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.devices.map(d => [d.lineKind, d.amount]), [['goods', '3000'], ['service', '1500']]);
  assert.equal(result.body.payments[0].amount, '4500');
  assert.equal(result.body.commerce.costCents, 200000);
  assert.equal((await request('/sales', body)).body._id, result.body._id);
  assert.equal(store.tables().Order.length, 1);
  assert.equal((await request('/sales', sale(asset._id, 'sale_request_222'))).status, 409);
});
test('cash sale allows an unknown customer and keeps payment and stock accounting', async () => {
  await request('/purchases', buy('anonymous_router'));
  const asset = store.tables().Asset.find(a => a.serial === 'anonymous_router');
  const body = sale(asset._id, 'anonymous_cash_sale');
  delete body.client;
  body.services = [];
  body.payments[0].amount = '3000';
  const result = await request('/sales', body);
  assert.equal(result.status, 201);
  assert.equal(result.body.client.lastName, '');
  assert.equal(result.body.client.firstName, '');
  assert.equal(result.body.client.phone, '');
  assert.equal(result.body.payments[0].amount, '3000');
  assert.equal(result.body.payments[0].paymentType, 'Готівка');
  assert.equal(store.tables().Asset.find(a => a._id === asset._id).status, 'sold');
});
test('simultaneous buyers cannot both purchase one asset', async () => {
  await request('/purchases', buy('serial_race'));
  const asset = store.tables().Asset.find(a => a.serial === 'serial_race');
  const results = await Promise.all([request('/sales', sale(asset._id, 'race_request_one')), request('/sales', sale(asset._id, 'race_request_two'))]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});
test('a failed multi-item sale leaves earlier assets available and creates no order', async () => {
  await request('/purchases', buy('serial_rollback'));
  const asset = store.tables().Asset.find(a => a.serial === 'serial_rollback');
  const body = sale(asset._id, 'rollback_request_111'); body.lines.push({ assetId: 'missing_asset_111', amount: '100' });
  const before = store.tables();
  assert.equal((await request('/sales', body)).status, 409);
  assert.deepEqual(store.tables(), before);
});
test('VPN transfer preserves sale, owner, expiry and cost and creates a free order', async () => {
  const p = { requestId: 'vpn_purchase_111', supplier: 'VPN', date: '2026-11-02', currency: 'UAH', items: [
    { kind: 'vpn-account', name: 'Nord VPN', serial: 'ifivpn259@ukr.net', unitPrice: 5187, slots: 9, expiresAt: '2028-11-02', slotCodes: Array.from({ length: 9 }, (_, i) => `997716259${i + 1}`) }] };
  assert.equal((await request('/purchases', p)).status, 201);
  const slot = store.tables().Asset.find(a => a.kind === 'vpn-slot');
  const s = sale(slot._id, 'vpn_sale_request'); s.lines[0].deviceModel = 'Inseego M3000'; s.lines[0].deviceSerial = 'original_router';
  assert.equal((await request('/sales', s)).status, 201);
  const before = store.tables().Asset.find(a => a._id === slot._id);
  const input = { requestId: 'vpn_transfer_request', assetId: slot._id, date: '2026-11-03', model: 'Novatel 8800L', serial: '990009317711557' };
  const result = await request('/transfers', input);
  assert.equal(result.status, 201);
  assert.equal(result.body.devices[0].amount, '0');
  assert.equal(result.body.commerce.costCents, 0);
  assert.equal((await request('/transfers', input)).body._id, result.body._id);
  const after = store.tables().Asset.find(a => a._id === slot._id);
  for (const key of ['status', 'orderId', 'client', 'expiresAt', 'costCents', 'saleCents']) assert.deepEqual(after[key], before[key]);
  assert.equal(after.binding.serial, input.serial);
  assert.equal(after.history.length, 2);
  assert.equal((await request('/sales', s)).status, 200);
  assert.equal((await request('/transfers', { ...input, requestId: 'expired_transfer_request', date: '2029-01-01' })).status, 400);
});
test('payment retry does not append the same payment twice and expense never adds stock', async () => {
  const before = store.tables().Asset.length;
  const result = await request('/expenses', { requestId: 'expense_request_111', date: '2026-07-01', category: 'Розхідники', description: '10000 TS9', amount: 5000, currency: 'USD', rate: 40 });
  assert.equal(result.status, 201);
  assert.equal(store.tables().Asset.length, before);
  const payment = { id: 'payment_request_111', date: '2026-07-01', amount: 5000, currency: 'USD', rate: 40, method: 'Готівка' };
  const path = `/expenses/${result.body._id}/payments`;
  assert.equal((await request(path, payment)).status, 201);
  assert.equal((await request(path, payment)).status, 201);
  assert.equal(store.tables().Expense.find(e => e._id === result.body._id).payments.length, 1);
});
test('VPN password is encrypted at rest, absent from snapshots, and readable only through the explicit endpoint', async () => {
  const input = { requestId: 'credentials_purchase_111', supplier: 'NordVPN supplier', date: '2026-11-02', currency: 'UAH', items: [
    { kind: 'vpn-account', name: 'NordVPN', serial: 'ifivpn777@ukr.net', login: 'separate-vpn-login', password: 'test-password-private', unitPrice: 900, slots: 1, slotCodes: ['777-slot-test'], expiresAt: '2028-11-02' }] };
  const created = await request('/purchases', input);
  assert.equal(created.status, 201);
  assert.equal(JSON.stringify(store.tables()).includes('test-password-private'), false);
  const snapshot = await request('');
  assert.ok(snapshot.body.assets.every(asset => !Object.hasOwn(asset, 'credentials')));
  assert.equal(JSON.stringify(snapshot.body).includes('test-password-private'), false);
  const asset = store.tables().Asset.find(a => a.serial === 'ifivpn777@ukr.net');
  assert.ok(asset.credentials.data);
  const credential = await request(`/assets/${asset._id}/credentials`);
  assert.equal(credential.body.password, 'test-password-private');
  assert.equal(credential.body.login, 'separate-vpn-login');
});
test('editing an unsold purchase updates costs and stock together and rejects stale forms', async () => {
  const input = buy('editable_router');
  const created = await request('/purchases', input), id = created.body._id;
  const assetId = store.tables().Asset.find(a => a.purchaseId === id)._id;
  const changed = { ...input, revision: 0, supplier: 'Updated supplier', items: [{ ...input.items[0], unitPrice: '75', complectation: ['АКБ'] }] };
  const result = await request(`/purchases/${id}`, changed, 'PUT');
  assert.equal(result.status, 200); assert.equal(result.body.totalCents, 300000); assert.equal(result.body.revision, 1);
  const asset = store.tables().Asset.find(a => a._id === assetId);
  assert.equal(asset.costCents, 300000); assert.deepEqual(asset.complectation, ['АКБ']);
  assert.equal(result.body.items[0].assetId, assetId);
  assert.equal((await request(`/purchases/${id}`, changed, 'PUT')).status, 409);
  assert.equal(result.body.revisions.length, 1);
});
test('failed edit rolls back removed stock, supplier and cost changes', async () => {
  const input = buy('edit_rollback_own');
  const created = await request('/purchases', input), id = created.body._id;
  const before = store.tables();
  const changed = { ...input, revision: 0, supplier: 'Should rollback', items: [{ ...input.items[0], serial: 'serial_111' }] };
  assert.equal((await request(`/purchases/${id}`, changed, 'PUT')).status, 409);
  assert.deepEqual(store.tables(), before);
});
test('sold stock prevents deletion and cost edits but allows supplier and document edits', async () => {
  const input = buy('sold_editable_router');
  const created = await request('/purchases', input), id = created.body._id;
  const asset = store.tables().Asset.find(a => a.purchaseId === id);
  await request('/sales', sale(asset._id, 'sold_edit_sale_request'));
  const oldAsset = store.tables().Asset.find(a => a._id === asset._id);
  const changed = { ...input, revision: 0, supplier: 'Corrected supplier', income: { invoiceNumber: '20450000000000', logisticType: 'post' } };
  const result = await request(`/purchases/${id}`, changed, 'PUT');
  assert.equal(result.status, 200);
  assert.equal(result.body.income.invoiceNumber, '20450000000000');
  assert.deepEqual(store.tables().Asset.find(a => a._id === asset._id), oldAsset);
  assert.equal((await request(`/purchases/${id}`, { ...changed, revision: 1, items: [{ ...input.items[0], unitPrice: '1' }] }, 'PUT')).status, 409);
  assert.equal((await request(`/purchases/${id}`, { revision: 1 }, 'DELETE')).status, 409);
});
test('deleting a purchase hides its stock and payments, retains audit data and releases serial numbers', async () => {
  const input = buy('delete_router_test');
  input.payments = [{ amount: 50, date: '2026-11-02', currency: 'USD', rate: 40, method: 'Готівка' }];
  const created = await request('/purchases', input), id = created.body._id;
  const result = await request(`/purchases/${id}`, { revision: 0 }, 'DELETE');
  assert.equal(result.status, 200);
  const snapshot = (await request('')).body;
  assert.ok(!snapshot.purchases.some(p => p._id === id));
  assert.ok(!snapshot.assets.some(a => a.purchaseId === id));
  assert.ok(store.tables().Purchase.find(p => p._id === id).deletedAt);
  assert.equal((await request(`/purchases/${id}/payments`, { amount: 1, currency: 'UAH', date: '2026-11-02', method: 'Готівка' })).status, 404);
  assert.equal((await request('/purchases', input)).status, 409);
  assert.equal((await request('/purchases', buy('delete_router_test', 'replacement_purchase_request'))).status, 201);
});
test('editing VPN metadata retains encrypted password and account/slot identities', async () => {
  const input = { requestId: 'vpn_edit_purchase_request', supplier: 'NordVPN', date: '2026-11-02', currency: 'UAH', items: [
    { kind: 'vpn-account', name: 'NordVPN', serial: 'ifivpn888@ukr.net', login: 'original-login', password: 'original-private-password', unitPrice: 900, slots: 1, slotCodes: ['888-slot-test'], expiresAt: '2029-05-02', subscriptionText: '2May2029' }] };
  const created = await request('/purchases', input), id = created.body._id;
  const oldAssets = store.tables().Asset.filter(a => a.purchaseId === id);
  const changed = { ...input, revision: 0, supplier: 'Corrected NordVPN', items: [{ ...input.items[0], password: '', login: 'corrected-login' }] };
  assert.equal((await request(`/purchases/${id}`, changed, 'PUT')).status, 200);
  assert.deepEqual(store.tables().Asset.filter(a => a.purchaseId === id).map(a => a._id), oldAssets.map(a => a._id));
  const credential = await request(`/assets/${oldAssets[0]._id}/credentials`);
  assert.equal(credential.body.password, 'original-private-password'); assert.equal(credential.body.login, 'corrected-login');
});
test('sale preserves client category, shipping documents and freight charges in the compatible order', async () => {
  const input = buy('sale_logistics_router');
  const created = await request('/purchases', input);
  const asset = store.tables().Asset.find(a => a.purchaseId === created.body._id);
  const body = sale(asset._id, 'logistics_sale_request');
  body.client = { lastName: 'Постійний клієнт', clientType: 'regular', isDropshipper: true, dropshipper: { label: 'Дропшипер' } };
  body.income = { date: '2026-11-01', logisticType: 'remote', invoicePrice: '0', comment: 'Замовлення онлайн' };
  body.outcome = { date: '2026-11-02', logisticType: 'post', invoiceNumber: '20450000000000', invoicePrice: '100', comment: 'Відправка' };
  const result = await request('/sales', body);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.outcome, { date: '11.02.2026', logisticType: 'post', invoiceNumber: '20450000000000', invoicePrice: '100', comment: 'Відправка' });
  assert.equal(result.body.income.date, '11.01.2026');
  assert.equal(result.body.client.clientType, 'regular');
  assert.equal(result.body.client.dropshipper.label, 'Дропшипер');
});

test('routers can be bought without IMEI, identified in batches and sold while remaining stock stays pending', async () => {
  const body = buy(''); body.requestId = 'pending_purchase_test'; body.items.push({ ...body.items[0] });
  const created = await request('/purchases', body);
  assert.equal(created.status, 201);
  const pending = store.tables().Asset.filter(a => a.purchaseId === body.requestId);
  assert.equal(pending.length, 2);
  assert.equal((await request('/sales', sale(pending[0]._id, 'unidentified_sale'))).status, 400);
  const identify = (index, serial, revision) => request(`/purchases/${body.requestId}/serials`, { revision, entries: [{ assetId: pending[index]._id, serial }] });
  assert.equal((await identify(0, 'identified_first', 0)).status, 200);
  assert.equal((await request('/sales', sale(pending[0]._id, 'identified_first_sale'))).status, 201);
  assert.equal((await identify(1, 'identified_first', 1)).status, 409);
  assert.equal(store.tables().Asset.find(a => a._id === pending[1]._id).serial, '');
  assert.equal((await identify(1, 'identified_second', 1)).status, 200);
  assert.equal((await identify(1, 'cannot_replace', 2)).status, 409);
  const saved = store.tables().Purchase.find(p => p._id === body.requestId);
  assert.equal(saved.totalCents, created.body.totalCents);
  assert.deepEqual(saved.items.map(i => i.serial), ['identified_first', 'identified_second']);
  assert.equal(store.tables().Asset.find(a => a._id === pending[0]._id).status, 'sold');
  assert.equal((await request('/sales', sale(pending[1]._id, 'identified_second_sale'))).status, 201);
});

test('IMEI batch rejects duplicates and rolls back earlier assignments', async () => {
  const body = buy(''); body.requestId = 'pending_rollback_test'; body.items.push({ ...body.items[0] });
  await request('/purchases', body);
  const pending = store.tables().Asset.filter(a => a.purchaseId === body.requestId);
  const result = await request(`/purchases/${body.requestId}/serials`, { revision: 0, entries: pending.map(a => ({ assetId: a._id, serial: 'same_imei' })) });
  assert.equal(result.status, 400);
  assert.ok(store.tables().Asset.filter(a => a.purchaseId === body.requestId).every(a => a.serial === ''));
  assert.equal((await request(`/purchases/${body.requestId}/serials`, { revision: 99, entries: [{ assetId: pending[0]._id, serial: 'new_imei' }] })).status, 409);
});

test('connection credentials are encrypted, explicitly readable and preserved through account edits', async () => {
  const input = { requestId: 'vpn_extended_credentials', supplier: 'NordVPN', date: '2026-11-02', currency: 'USD', rate: 40, items: [{ kind: 'vpn-account', name: 'NordVPN', serial: 'demo888@example.test', unitPrice: '90', password: 'synthetic-account-secret', serviceLogin: 'synthetic-connection-login', servicePassword: 'synthetic-connection-secret', testId: 'test8880', slots: 2, slotCodes: ['test8881', 'test8882'], expiresAt: '2029-05-02' }] };
  const created = await request('/purchases', input);
  assert.equal(created.status, 201);
  const account = store.tables().Asset.find(a => a.serial === 'demo888@example.test');
  const snapshot = JSON.stringify((await request('')).body), stored = JSON.stringify(store.tables());
  for (const secret of ['synthetic-account-secret', 'synthetic-connection-login', 'synthetic-connection-secret']) {
    assert.equal(snapshot.includes(secret), false); assert.equal(stored.includes(secret), false);
  }
  assert.equal(store.tables().Asset.some(a => a.serial === 'test8880'), false);
  let credentials = await request(`/assets/${account._id}/credentials`);
  assert.equal(credentials.body.servicePassword, 'synthetic-connection-secret');
  const changed = JSON.parse(JSON.stringify(input)); changed.revision = 0;
  changed.items[0].password = 'synthetic-new-account-secret'; delete changed.items[0].serviceLogin; delete changed.items[0].servicePassword;
  assert.equal((await request(`/purchases/${input.requestId}`, changed, 'PUT')).status, 200);
  credentials = await request(`/assets/${account._id}/credentials`);
  assert.equal(credentials.body.password, 'synthetic-new-account-secret');
  assert.equal(credentials.body.serviceLogin, 'synthetic-connection-login');
  assert.equal(credentials.body.servicePassword, 'synthetic-connection-secret');
});

test('test VPN sale can be cancelled before deleting its purchase, retaining archived order and audit', async () => {
  const input = { requestId: 'cancel_vpn_purchase', supplier: 'Test account', date: '2026-11-02', currency: 'UAH', rate: 1, items: [{ kind: 'vpn-account', name: 'NordVPN', serial: 'cancel-test@example.test', unitPrice: '900', slots: 2, slotCodes: ['cancel-test-slot-1', 'cancel-test-slot-2'], expiresAt: '2029-05-02' }] };
  assert.equal((await request('/purchases', input)).status, 201);
  const slot = store.tables().Asset.find(a => a.serial === 'cancel-test-slot-1');
  const body = { ...sale(slot._id, 'cancel_vpn_sale'), services: [], lines: [{ assetId: slot._id, amount: '1500', deviceModel: '8800', deviceSerial: 'cancel-router' }] };
  const sold = await request('/sales', body); assert.equal(sold.status, 201);
  const { cancelStockOrder } = require('../commerce/cancelOrder');
  await cancelStockOrder({ id: sold.body._id, Order: store.Order, Asset: store.models.Asset, connection: store.mongoose, user: { role: 'admin', id: 'test' } });
  assert.equal((await request('/sales', body)).status, 409);
  assert.equal((await request('/purchases/' + input.requestId, { revision: 0 }, 'DELETE')).status, 200);
  assert.ok(store.tables().Order.find(o => o._id === sold.body._id).deletedAt);
  assert.ok(store.tables().Asset.filter(a => a.purchaseId === input.requestId).every(a => a.status === 'void'));
});
