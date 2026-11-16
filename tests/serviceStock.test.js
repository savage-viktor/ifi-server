const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { memoryStore } = require('./helpers/commerceMemory');
const D = require('../commerce/domain');
const { saveServiceStock } = require('../commerce/serviceStock');
const { report } = require('../commerce/report');
async function setup() {
  const store = memoryStore();
  const prepared = D.purchase({ supplier: 'Test', date: '2026-11-02', currency: 'USD', rate: 40, items: [{ kind: 'vpn-account', name: 'NordVPN', serial: 'demo@example.test', unitPrice: '90', expiresAt: '2029-05-02', slots: 2, slotCodes: ['test-slot-one', 'test-slot-two'] }] });
  await store.models.Asset.insertMany(prepared.assets);
  const deps = { Asset: store.models.Asset, Order: store.Order, connection: store.mongoose, user: { role: 'admin' } };
  const slot = prepared.assets.find(a => a.kind === 'vpn-slot');
  const data = { _id: randomUUID(), orderNumber: 1, client: { lastName: 'Test', firstName: 'Client' }, income: { date: '11.05.2026' }, outcome: { date: '11.05.2026' }, devices: [{ id: 'router', model: '8800', imei: 'test-router-imei', amount: '2300', service: 'Прошивка, Активація VPN', services: [{ name: 'Прошивка' }, { name: 'Активація VPN', inventoryItemId: slot._id, vpnId: 'client-supplied-wrong' }] }] };
  return { store, deps, slot, data };
}
test('service order claims VPN once, preserves bundle total, and includes actual cost in report', async () => {
  const { store, deps, slot, data } = await setup();
  const order = await saveServiceStock({ ...deps, data });
  assert.equal(order.devices[0].services[1].vpnId, slot.serial);
  assert.equal(order.devices[0].amount, '2300');
  const sold = store.tables().Asset.find(a => a._id === slot._id);
  assert.equal(sold.status, 'sold'); assert.equal(sold.binding.serial, 'test-router-imei'); assert.equal(sold.saleCents, null); assert.equal(sold.bundleTotalCents, 230000);
  const edited = await saveServiceStock({ ...deps, data: { ...order, payments: [{ amount: '2300', date: '11.05.2026' }] }, previous: order });
  assert.equal(edited.inventoryCostCents, slot.costCents);
  assert.equal(store.tables().Asset.find(a => a._id === slot._id).history.length, 1);
  const result = report({ orders: [edited], purchases: [], expenses: [], assets: store.tables().Asset });
  assert.equal(result.revenueCents, 230000); assert.equal(result.costCents, slot.costCents); assert.equal(result.legacyUncostedRevenueCents, 0);
  await assert.rejects(saveServiceStock({ ...deps, data: { ...order, devices: [] }, previous: order }), /прибрати/);
  await assert.rejects(saveServiceStock({ ...deps, data: { ...data, _id: randomUUID() } }), /продана/);
});
test('competing orders and invalid multi-slot requests cannot consume stock twice or partially', async () => {
  const { store, deps, slot, data } = await setup();
  const invalid = JSON.parse(JSON.stringify(data)); invalid.devices[0].services.push({ name: 'Активація VPN', inventoryItemId: 'unknown-asset-id' });
  await assert.rejects(saveServiceStock({ ...deps, data: invalid }), /не знайдено/);
  assert.equal(store.tables().Asset.find(a => a._id === slot._id).status, 'available'); assert.equal(store.tables().Order.length, 0);
  const results = await Promise.allSettled([saveServiceStock({ ...deps, data }), saveServiceStock({ ...deps, data: { ...data, _id: randomUUID() } })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(store.tables().Order.length, 1);
});

test('cancelling a service-stock order returns its place once and removes cancelled totals from reports', async () => {
  const { cancelStockOrder } = require('../commerce/cancelOrder');
  const { store, deps, slot, data } = await setup();
  const order = await saveServiceStock({ ...deps, data });
  const cancelled = await cancelStockOrder({ id: order._id, ...deps });
  assert.ok(cancelled.deletedAt); assert.equal(cancelled.devices[0].amount, '2300');
  const restored = store.tables().Asset.find(a => a._id === slot._id);
  assert.equal(restored.status, 'available'); assert.equal(restored.orderId, null); assert.equal(restored.history.at(-1).action, 'cancel-sale');
  await cancelStockOrder({ id: order._id, ...deps });
  assert.equal(store.tables().Asset.find(a => a._id === slot._id).history.length, 2);
  const totals = report({ orders: store.tables().Order, assets: store.tables().Asset, purchases: [], expenses: [] });
  assert.equal(totals.revenueCents, 0); assert.equal(totals.costCents, 0); assert.equal(totals.customerDebtCents, 0);
});
test('cancelling cannot release a VPN place after a later transfer', async () => {
  const { cancelStockOrder } = require('../commerce/cancelOrder');
  const { store, deps, slot, data } = await setup();
  const order = await saveServiceStock({ ...deps, data });
  await store.models.Asset.updateOne({ _id: slot._id }, { $push: { history: { action: 'transfer', orderId: 'later-transfer' } } });
  await assert.rejects(cancelStockOrder({ id: order._id, ...deps }), /переносили/);
  assert.equal(store.tables().Asset.find(a => a._id === slot._id).status, 'sold'); assert.equal(store.tables().Order[0].deletedAt, undefined);
});

test('failed multi-place cancellation rolls back earlier returns', async () => {
  const { cancelStockOrder } = require('../commerce/cancelOrder');
  const { store, deps, data } = await setup();
  const second = store.tables().Asset.filter(a => a.kind === 'vpn-slot')[1];
  data.devices[0].services.push({ name: 'Активація VPN', inventoryItemId: second._id });
  const order = await saveServiceStock({ ...deps, data });
  await store.models.Asset.updateOne({ _id: second._id }, { $set: { status: 'available' } });
  const before = store.tables();
  await assert.rejects(cancelStockOrder({ id: order._id, ...deps }), /Стан позицій/);
  assert.deepEqual(store.tables(), before);
});
