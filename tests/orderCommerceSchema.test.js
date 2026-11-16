const { test } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/orderModel');
test('sale and transfer metadata are structured subdocuments, not a String inferred from type', async () => {
  for (const type of ['sale', 'transfer']) {
    const commerce = { operationId: 'test-operation', type, date: '2026-11-05', costCents: 24750000 };
    const order = new Order({ commerce }); await order.validate();
    assert.deepEqual(order.toObject().commerce, commerce);
    assert.equal(order.commerce.operationId, commerce.operationId);
    assert.equal(order.commerce.costCents, 24750000);
  }
});
test('legacy orders without commerce remain unchanged and do not gain empty metadata', async () => {
  const order = new Order({ orderNumber: 2700000, devices: [{ model: '8800', service: 'Ремонт', amount: '600' }] });
  await order.validate(); assert.equal(order.toObject().commerce, undefined);
  assert.equal(order.devices[0].amount, '600');
});
