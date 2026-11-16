const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeviceServices } = require('../orderServices');
const { applyWorkerPricing } = require('../workerPricing');
const Order = require('../models/orderModel');
test('multiple services preserve one device, VPN ID and one manually established total through schema serialization', async () => {
  const device = normalizeDeviceServices({ id: 'device-one', model: '8800', imei: 'test-imei', amount: '2300', service: 'old', services: [{ name: 'Прошивка' }, { name: 'Активація VPN', vpnId: '9977163211' }] });
  const order = new Order({ devices: [device] }); await order.validate();
  const saved = order.toObject().devices[0];
  assert.equal(saved.amount, '2300'); assert.equal(saved.service, 'Прошивка, Активація VPN');
  assert.equal(saved.services.length, 2); assert.equal(saved.services[1].vpnId, '9977163211');
  const worker = applyWorkerPricing({ devices: [{ ...device, amount: '99999' }] }, [], { client: {}, devices: [device] });
  assert.equal(worker.devices[0].amount, '2300');
});
test('legacy service strings remain unchanged and structured services cannot bypass worker price changes', () => {
  const old = { id: 'one', model: '8800', service: 'Прошивка', amount: '600' };
  assert.deepEqual(normalizeDeviceServices(old), old);
  const changed = applyWorkerPricing({ devices: [{ ...old, services: [{ name: 'Прошивка' }, { name: 'Активація VPN', vpnId: 'test-id' }] }] }, [], { client: {}, devices: [old] });
  assert.equal(changed.devices[0].service, 'Прошивка, Активація VPN'); assert.equal(changed.devices[0].amount, '0');
});
