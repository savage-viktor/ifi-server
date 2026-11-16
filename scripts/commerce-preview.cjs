// Local demonstration only. Never connects to MongoDB or imports production secrets.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { memoryStore } = require('../tests/helpers/commerceMemory');
const { createCommerceRouter } = require('../commerce/routes');
const D = require('../commerce/domain');
const store = memoryStore();
store.credentialKey = () => 'local-preview-credentials-key-only';
const app = express(); app.use(express.json());
const session = () => ({ token: 'local-preview-only', expiresAt: Date.now() + 12 * 3600000, user: { role: 'admin', id: 'preview', name: 'Демонстрація' } });
app.post('/backend/auth/login', (req, res) => res.json(session()));
app.use('/backend', (req, res, next) => { req.user = session().user; next(); });
app.get('/backend/auth/me', (req, res) => res.json({ user: session().user }));
app.use('/backend/commerce', createCommerceRouter(store));
app.get('/backend/orders', async (req, res) => res.json(await store.Order.find()));
app.get('/backend/orders/:id', async (req, res) => res.json(await store.Order.findById(req.params.id)));
const serviceStock = require('../commerce/serviceStock');
const stockDeps = { Asset: store.models.Asset, Order: store.Order, connection: store.mongoose };
app.post('/backend/orders', async (req, res) => {
  try {
    const devices = (req.body.devices || []).map(require('../orderServices').normalizeDeviceServices);
    const data = { ...req.body, _id: randomUUID(), devices, orderNumber: await store.nextOrderNumber(), status: 'open' };
    const order = serviceStock.selections(data).length ? await serviceStock.saveServiceStock({ ...stockDeps, data, user: req.user }) : await store.Order.create(data);
    res.status(201).json(order);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.put('/backend/orders/:id', async (req, res) => {
  try {
    const previous = await store.Order.findById(req.params.id);
    if (!previous) return res.status(404).json({ error: 'not_found' });
    const update = previous.commerce ? { payments: req.body.payments, income: req.body.income, outcome: req.body.outcome } : { ...req.body, devices: (req.body.devices || previous.devices).map(require('../orderServices').normalizeDeviceServices) };
    const order = previous.vpnStock || serviceStock.selections(update).length ? await serviceStock.saveServiceStock({ ...stockDeps, data: update, previous, user: req.user }) : await store.Order.findByIdAndUpdate(req.params.id, { $set: update });
    res.json(order);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.patch('/backend/orders/:id/status', async (req, res) => res.json(await store.Order.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } })));
app.get('/backend/clients', (req, res) => res.json([{ firstName: 'Приклад', lastName: 'Клієнт', phone: '', city: 'Київ', clientType: 'retail' }]));
for (const catalog of ['models', 'services', 'components']) app.get(`/backend/${catalog}`, (req, res) => res.json([]));
const build = path.resolve(__dirname, '../../ifi-service-admin-page/commerce-preview');
app.get(['/', '/admin.html'], (req, res) => {
  const filename = ['admin.html', 'index.html'].map(name => path.join(build, name)).find(name => fs.existsSync(name));
  if (!filename) return res.status(503).send('Build the local preview first; see COMMERCE.md');
  const bootstrap = `<script>localStorage.setItem('ifi-admin-session',${JSON.stringify(JSON.stringify(session()))});</script>`;
  const banner = '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff4cf;color:#634600;text-align:center;padding:5px;font:13px sans-serif;z-index:1500">ДЕМОНСТРАЦІЯ · тестові дані · зміни зникають після перезапуску · робоча база не використовується</div>';
  res.type('html').send(fs.readFileSync(filename, 'utf8').replace('</head>', `${bootstrap}</head>`).replace('</body>', `${banner}</body>`));
});
app.use(express.static(build, { index: false }));
async function seed() {
  const purchase = D.purchase({ supplier: 'Приклад постачальника', date: '2026-11-02', currency: 'USD', rate: '43.225', items: [
    ...['990018053549394', '990018050925852', '990018053562447'].map(serial => ({ kind: 'router', name: 'Inseego M3100', serial, unitPrice: '50' })),
    { kind: 'vpn-account', name: 'Nord VPN', serial: 'ifivpn259@ukr.net', unitPrice: '120', slots: 9, expiresAt: '2028-11-02', slotCodes: Array.from({ length: 9 }, (_, i) => `997716259${i + 1}`) },
  ], payments: [{ date: '2026-11-02', amount: '270', currency: 'USD', rate: '43.225', method: 'Готівка' }] });
  await store.models.Purchase.create(purchase.document); await store.models.Asset.insertMany(purchase.assets);
  await store.models.Expense.create(D.expense({ date: '2026-07-01', category: 'Розхідники', description: 'Приклад: 10000 антенних роз’ємів TS9 по $0,50', amount: '5000', currency: 'USD', rate: '40',
    payments: [{ date: '2026-07-01', amount: '5000', currency: 'USD', rate: '40', method: 'Готівка' }] }));
  const vpn = purchase.assets.find(a => a.kind === 'vpn-slot'), router = purchase.assets.find(a => a.kind === 'router');
  const client = { lastName: 'Клієнт', firstName: 'Приклад', phone: '', city: 'Київ', clientType: 'retail' }, orderId = '6ae8c47d4ff0792735707a47';
  await store.Order.create({ _id: orderId, orderNumber: 2704834, client, status: 'open', createdBy: session().user,
    income: { date: '11.02.2026', logisticType: 'remote', invoicePrice: '' }, outcome: { date: '11.02.2026', logisticType: 'remote', invoicePrice: '' },
    devices: [
      { id: randomUUID(), inventoryItemId: router._id, lineKind: 'goods', model: router.name, imei: router.serial, service: 'Продаж', amount: '3000', complectation: [] },
      { id: randomUUID(), inventoryItemId: vpn._id, lineKind: 'vpn', model: router.name, imei: router.serial, imeiInner: vpn.serial, service: 'Активація VPN', amount: '1500', complectation: [] },
    ], payments: [{ date: '11.02.2026', amount: '4500', paymentType: 'ПриватБанк' }],
    commerce: { operationId: 'preview_sale', type: 'sale', date: '2026-11-02', costCents: router.costCents + vpn.costCents } });
  for (const asset of [vpn, router]) await store.models.Asset.updateOne({ _id: asset._id }, { $set: { status: 'sold', orderId,
    client, binding: { model: router.name, serial: router.serial }, soldAt: '2026-11-02', saleCents: asset.kind === 'router' ? 300000 : 150000 },
    $push: { history: { id: randomUUID(), action: 'sale', date: '2026-11-02', orderId, model: router.name, serial: router.serial } } });
}
seed().then(() => app.listen(4317, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4317/admin.html#/commerce'))).catch(error => { console.error(error); process.exitCode = 1; });
