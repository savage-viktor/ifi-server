const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../commerce/domain');
const { report } = require('../commerce/report');
const { credentialStore } = require('../commerce/credentials');
const vpn = overrides => ({ supplier: 'VPN supplier', date: '2026-11-02', currency: 'USD', rate: '43.225',
  items: [{ kind: 'vpn-account', name: 'Nord VPN', serial: 'ifivpn259@ukr.net', unitPrice: '120', slots: 9,
    expiresAt: '2028-11-02', slotCodes: Array.from({ length: 9 }, (_, i) => `997716259${i + 1}`) }], ...overrides });

test('VPN purchase splits one account into nine unique sellable places without doubling cost', () => {
  const { document, assets } = D.purchase(vpn());
  const slots = assets.filter(a => a.kind === 'vpn-slot');
  assert.equal(document.totalCents, 518700);
  assert.equal(document.totalOriginalCents, 12000);
  assert.equal(assets.length, 10);
  assert.equal(slots.reduce((s, a) => s + a.costCents, 0), document.totalCents);
  assert.equal(slots.reduce((s, a) => s + a.originalCents, 0), 12000);
  assert.equal(slots[0].accountEmail, 'ifivpn259@ukr.net');
  assert.equal(new Set(slots.map(a => a.key)).size, 9);
  assert.equal(D.available(slots[0], '2026-11-02'), slots[0]);
  assert.throws(() => D.available(assets[0], '2026-11-02'), /недоступна/);
});
test('freight cost is allocated exactly once to sellable units and rates are frozen', () => {
  const result = D.purchase(vpn({ extraUah: '100.01' }));
  assert.equal(result.assets.filter(a => a.kind !== 'vpn-account').reduce((s, a) => s + a.costCents, 0), result.document.totalCents);
  assert.equal(result.document.rate, 43.225);
  assert.equal(result.document.extraCents, 10001);
});
test('purchase stores supplier, inbound logistics and equipment completeness without exposing VPN secrets in documents', () => {
  const input = vpn({ income: { logisticType: 'post', invoiceNumber: '20450000000000', comment: 'Доставка' }, extraUah: '100', supplierDetails: { phone: 'test-phone', city: 'Київ' } });
  input.items[0].password = 'test-secret-only';
  const result = D.purchase(input);
  assert.equal(result.document.income.invoiceNumber, '20450000000000');
  assert.equal(result.document.income.invoicePrice, '100');
  assert.equal(result.document.supplierDetails.city, 'Київ');
  assert.equal(JSON.stringify(result.document).includes('test-secret-only'), false);
  assert.equal(result.credentials.length, 1);
  assert.equal(result.assets.filter(a => a.hasCredentials).length, 1);
  const router = D.purchase({ supplier: 'Supplier', date: '2026-11-02', currency: 'UAH', items: [{ kind: 'router', name: 'M3100', serial: 'test-serial', unitPrice: 100, complectation: ['АКБ', 'Кришка'] }] });
  assert.deepEqual(router.assets[0].complectation, ['АКБ', 'Кришка']);
});
test('VPN password encryption is randomized, authenticated and reversible only with the server key', () => {
  const vault = credentialStore(() => 'test-credential-key-at-least-16-characters');
  const first = vault.encrypt('test-password'), second = vault.encrypt('test-password');
  assert.notEqual(first.data, second.data);
  assert.equal(vault.decrypt(first), 'test-password');
  assert.equal(JSON.stringify(first).includes('test-password'), false);
  assert.throws(() => credentialStore(() => 'a-different-test-credential-key').decrypt(first));
  assert.throws(() => vault.decrypt({ ...first, tag: Buffer.alloc(16).toString('base64') }));
});
test('invalid, duplicate, negative or expired stock operations are rejected', () => {
  const input = vpn(); input.items[0].slotCodes[1] = input.items[0].slotCodes[0];
  assert.throws(() => D.purchase(input), /повторні/);
  for (const bad of ['-10', 'NaN', 'Infinity', '', '1.001', {}, '1e8']) assert.throws(() => D.cents(bad));
  assert.throws(() => D.date('2026-02-30'), /дата/);
  assert.throws(() => D.purchase(vpn({ rate: 0 })), /курс/);
  const slot = D.purchase(vpn()).assets[1];
  assert.throws(() => D.available({ ...slot, status: 'sold' }, '2026-11-02'), /продана/);
  assert.throws(() => D.available(slot, '2029-01-01'), /закінчився/);
  assert.throws(() => D.available(slot, '2026-11-01'), /передувати/);
  assert.throws(() => D.identifier({ $ne: null }));
});
test('consumables are one expense, with independent original currency and actual payment', () => {
  const expense = D.expense({ date: '2026-07-01', category: 'Розхідники', description: '10000 TS9 по $0.50',
    currency: 'USD', rate: '40', amount: '5000', payments: [{ date: '2026-07-02', amount: '5000', currency: 'USD', rate: 41, method: 'Готівка' }] });
  assert.equal(expense.uahCents, 20000000);
  assert.equal(expense.payments[0].uahCents, 20500000);
  assert.equal(expense.amountCents, 500000);
  assert.equal(expense.items, undefined);
  assert.equal(D.settledUahCents(expense.payments[0], expense), expense.uahCents, 'the whole $5000 debt is settled even if payment FX differs');
});
test('cross-currency settlement and barter settle debt without inventing money movement', () => {
  const purchase = { currency: 'USD', rate: 40, totalCents: 400000, payments: [
    D.payment({ amount: 3900, currency: 'UAH', rate: 1, date: '2026-11-02', method: 'Бартер', settlementAmount: 100 }),
  ] };
  const result = report({ orders: [], assets: [], expenses: [], purchases: [purchase] });
  assert.equal(result.supplierDebtCents, 0);
  assert.equal(result.paymentsCents, 0);
  assert.equal(result.barterCents, 390000);
});
test('report separates earned revenue, stock cost, expenses and cash and includes old orders once', () => {
  const input = {
    orders: [
      { outcome: { date: '11.02.2026' }, devices: [{ amount: '-2000', service: 'Купівля' }], payments: [{ date: '11.02.2026', amount: '-2000' }] },
      { commerce: { date: '2026-11-02', costCents: 200000 }, devices: [{ amount: '3000', lineKind: 'goods' }, { amount: '1500', lineKind: 'service' }], payments: [{ date: '11.03.2026', amount: '4500' }] },
      { commerce: { date: '2026-11-02', costCents: 0 }, devices: [{ amount: '0', service: 'Перенесення VPN' }], payments: [] },
    ], purchases: [{ totalCents: 200000, payments: [{ date: '2026-11-02', uahCents: 200000 }] }],
    expenses: [{ date: '2026-11-02', uahCents: 50000, payments: [] }],
    assets: [{ kind: 'vpn-account', costCents: 90000, status: 'available' },
      { kind: 'vpn-slot', costCents: 10000, status: 'available', expiresAt: '2028-01-01' },
      { kind: 'vpn-slot', costCents: 10000, status: 'available', expiresAt: '2020-01-01' }],
  };
  const r = report(input, '2026-11-02', '2026-11-02', '2026-11-02');
  assert.equal(r.revenueCents, 450000);
  assert.equal(r.costCents, 200000);
  assert.equal(r.resultCents, 200000);
  assert.equal(r.paymentsCents, 400000);
  assert.equal(r.receiptsCents, 0);
  assert.equal(r.stockCents, 10000);
  assert.equal(r.expiredVpnCents, 10000);
  assert.equal(r.supplierDebtCents, 50000);
  assert.equal(report(input, '2026-11-03', '2026-11-03').receiptsCents, 450000);
});
