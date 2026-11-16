const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyWorkerPricing, resolvePrice } = require('../workerPricing');
const services = [{ name: 'Ремонт', prices: [
  { amount: 100, models: ['8800'], clients: [], dropshippers: [] },
  { amount: 80, models: ['8800'], clients: [], dropshippers: ['Дилер'] },
  { amount: 60, models: ['8800'], clients: ['Іваненко Іван'], dropshippers: [] },
] }];
const device = { id: 'device', model: '8800', service: 'Ремонт', amount: '999999' };
test('server selects model-specific general, dropshipper and personal prices, including zero', () => {
  assert.equal(resolvePrice(services, device), 100);
  assert.equal(resolvePrice(services, device, { dropshipper: { label: 'Дилер' } }), 80);
  assert.equal(resolvePrice(services, device, { lastName: 'Іваненко', firstName: 'Іван', dropshipper: { label: 'Дилер' } }), 60);
  assert.equal(resolvePrice(services, { ...device, model: '7730' }), undefined);
  assert.equal(resolvePrice([{ name: 'Ремонт', prices: [{ amount: 0, models: ['8800'] }] }], device), 0);
});
test('worker creation uses server price and cannot create payments', () => {
  const result = applyWorkerPricing({ devices: [device], payments: [{ amount: '999' }] }, services);
  assert.equal(result.devices[0].amount, '100');
  assert.deepEqual(result.payments, []);
});
test('unchanged established prices survive, while missing zero prices are repaired', () => {
  const previous = { client: {}, devices: [{ ...device, amount: '500' }], payments: [{ amount: '25' }] };
  const result = applyWorkerPricing({ devices: [device], payments: [] }, services, previous);
  assert.equal(result.devices[0].amount, '500');
  assert.equal('payments' in result, false);
  assert.equal(applyWorkerPricing({ devices: [device] }, services, { ...previous, devices: [{ ...device, amount: '0' }] }).devices[0].amount, '100');
  assert.equal(previous.devices[0].amount, '500');
});
test('changing client, model or service recalculates rather than reusing an old price', () => {
  const previous = { client: {}, devices: [{ ...device, amount: '500' }] };
  assert.equal(applyWorkerPricing({ client: { lastName: 'Іваненко', firstName: 'Іван' }, devices: [device] }, services, previous).devices[0].amount, '60');
  assert.equal(applyWorkerPricing({ devices: [{ ...device, model: '7730' }] }, services, previous).devices[0].amount, '0');
  assert.equal(applyWorkerPricing({ devices: [{ ...device, service: 'Інша' }] }, services, previous).devices[0].amount, '0');
});
