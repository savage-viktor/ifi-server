const express = require('express');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const D = require('./domain');
const { report } = require('./report');
const models = require('./models');
const Order = require('../models/orderModel');
const { nextOrderNumber } = require('./orderNumber');

function createCommerceRouter(deps = {}) {
  const { Purchase, Asset, Expense, Operation } = deps.models || models;
  const Orders = deps.Order || Order;
  const connection = deps.mongoose || mongoose;
  const allocateNumber = deps.nextOrderNumber || nextOrderNumber;
  const router = express.Router();
  const secrets = require('./credentials').credentialStore(deps.credentialKey);
  const route = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      const duplicate = error.code === 11000;
      const status = duplicate ? 409 : error.status || (error.name === 'ValidationError' ? 400 : 500);
      if (status === 500) console.error('Commerce operation failed:', error.message);
      res.status(status).json({ error: duplicate ? 'Цей серійний номер, код VPN або операція вже існує. Оновіть дані.' :
        status === 500 ? 'Не вдалося зберегти операцію. Зміни не проведено; перевірте доступність бази та підтримку транзакцій.' : error.message });
    }
  };
  async function transaction(fn) {
    // Create collections/indexes before entering the transaction, including on a fresh database.
    await Promise.all([Purchase, Asset, Expense, Operation, Orders].map(model => model.init()));
    const session = await connection.startSession();
    try { let result; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  async function snapshot() {
    const [purchases, assets, expenses] = await Promise.all([
      Purchase.find({ deletedAt: { $exists: false } }).sort({ date: -1 }).lean(), Asset.find({ status: { $ne: 'void' } }).lean(), Expense.find().sort({ date: -1 }).lean(),
    ]);
    return { purchases, assets: assets.map(({ credentials, ...asset }) => asset), expenses };
  }
  router.get('/', route(async (req, res) => res.json(await snapshot())));
  router.get('/assets/:id/credentials', route(async (req, res) => {
    const asset = await Asset.findById(D.identifier(req.params.id)).lean();
    if (!asset || asset.kind !== 'vpn-account') throw new D.InputError('VPN-акаунт не знайдено', 404);
    res.set('Cache-Control', 'no-store');
    const decrypted = asset.credentials ? secrets.decrypt(asset.credentials) : null;
    res.json(asset.credentials?.format === 'account-v1' ? JSON.parse(decrypted) : { login: asset.serial, password: decrypted });
  }));
  router.get('/report', route(async (req, res) => {
    const from = req.query.from ? D.date(req.query.from) : '', to = req.query.to ? D.date(req.query.to) : '';
    if (from && to && from > to) throw new D.InputError('Початок періоду має бути не пізніше завершення');
    const [data, orders] = await Promise.all([snapshot(), Orders.find().lean()]);
    res.json(report({ ...data, orders }, from, to));
  }));
  router.post('/purchases', route(async (req, res) => {
    const prepared = D.purchase(req.body);
    const previous = await Purchase.findById(prepared.document._id).lean();
    if (previous?.deletedAt) throw new D.InputError('Цю закупівлю вже видалено. Створіть нову закупівлю.', 409);
    if (previous) return res.json(previous);
    encryptCredentials(prepared);
    prepared.document.revision = 0;
    await transaction(async session => {
      await Purchase.create([prepared.document], { session });
      await Asset.insertMany(prepared.assets, { session });
    });
    res.status(201).json(prepared.document);
  }));
  function encryptCredentials(prepared) {
    for (const credential of prepared.credentials) prepared.assets.find(asset => asset._id === credential.assetId).credentials = {
      ...secrets.encrypt(JSON.stringify({ login: credential.login, password: credential.password, serviceLogin: credential.serviceLogin, servicePassword: credential.servicePassword })), format: 'account-v1',
    };
  }
  function assertRevision(previous, expected) {
    if (!Number.isInteger(expected) || expected !== (previous.revision || 0)) throw new D.InputError('Закупівлю вже змінили в іншій вкладці. Оновіть список і відкрийте її повторно.', 409);
  }
  const stockSignature = assets => JSON.stringify(assets.map(a => ({
    kind: a.kind, serial: a.serial, name: a.name, originalCents: a.originalCents, costCents: a.costCents,
    currency: a.currency, rate: a.rate, acquiredAt: a.acquiredAt || '', expiresAt: a.expiresAt || '',
    complectation: a.complectation || [],
  })).sort((a, b) => `${a.kind}:${a.serial}`.localeCompare(`${b.kind}:${b.serial}`)));
  router.put('/purchases/:id', route(async (req, res) => {
    const id = D.identifier(req.params.id);
    const prepared = D.purchase({ ...req.body, requestId: id });
    encryptCredentials(prepared);
    const result = await transaction(async session => {
      const previous = await Purchase.findById(id).session(session).lean();
      if (!previous || previous.deletedAt) throw new D.InputError('Закупівлю не знайдено', 404);
      assertRevision(previous, req.body.revision);
      const oldAssets = await Asset.find({ purchaseId: id, status: { $ne: 'void' } }).session(session).lean();
      const sold = oldAssets.some(asset => asset.status === 'sold');
      if (sold && stockSignature(oldAssets) !== stockSignature(prepared.assets)) throw new D.InputError('У цій закупівлі вже є продажі. Можна редагувати постачальника, ТТН, коментарі, платежі та доступи VPN. Змінювати склад і собівартість проданого не можна.', 409);
      const mapping = new Map();
      for (const next of prepared.assets) {
        const old = oldAssets.find(asset => asset.key === next.key);
        if (old) mapping.set(next._id, old._id);
      }
      for (const next of prepared.assets) {
        const generatedId = next._id;
        next._id = mapping.get(generatedId) || generatedId;
        if (next.accountId) next.accountId = mapping.get(next.accountId) || next.accountId;
        const old = oldAssets.find(asset => asset._id === next._id);
        if (old?.credentials) {
          const plaintext = secrets.decrypt(old.credentials);
          const saved = old.credentials.format === 'account-v1' ? JSON.parse(plaintext) : { login: old.serial, password: plaintext };
          const input = req.body.items.find(item => item.kind === 'vpn-account' && item.serial === next.serial) || {};
          const merged = { ...saved };
          for (const key of ['login', 'password', 'serviceLogin', 'servicePassword']) {
            if (typeof input[key] === 'string' && input[key] !== '') {
              if (input[key].length > 1000) throw new D.InputError('Некоректні доступи VPN');
              merged[key] = input[key];
            }
          }
          next.credentials = { ...secrets.encrypt(JSON.stringify(merged)), format: 'account-v1' }; next.hasCredentials = true;
        }
      }
      for (const item of prepared.document.items) item.assetId = mapping.get(item.assetId) || item.assetId;
      for (const old of oldAssets) {
        if (!prepared.assets.some(asset => asset._id === old._id)) await Asset.updateOne({ _id: old._id }, { $set: { status: 'void', originalKey: old.key, key: `void:${old._id}:${old.key}` } }, { session });
      }
      for (const next of prepared.assets) {
        const old = oldAssets.find(asset => asset._id === next._id);
        if (old) {
          const { _id, ...fields } = next;
          const changes = sold ? { ...(next.kind === 'vpn-account' ? { testId: next.testId } : {}), ...(next.credentials ? { credentials: next.credentials, hasCredentials: true } : {}) } : fields;
          if (Object.keys(changes).length) await Asset.updateOne({ _id }, { $set: changes }, { session });
        } else await Asset.create([next], { session });
      }
      const { _id, revisions, ...history } = previous;
      const { _id: ignored, ...fields } = prepared.document;
      return await Purchase.findOneAndUpdate({ _id: id }, { $set: { ...fields, revision: (previous.revision || 0) + 1 }, $push: { revisions: { ...history, changedAt: new Date().toISOString() } } }, { session, new: true });
    });
    res.json(result);
  }));
  router.post('/purchases/:id/serials', route(async (req, res) => {
    const id = D.identifier(req.params.id), entries = D.list(req.body.entries);
    if (!entries.length) throw new D.InputError('Введіть хоча б один IMEI');
    const result = await transaction(async session => {
      const previous = await Purchase.findById(id).session(session).lean();
      if (!previous || previous.deletedAt) throw new D.InputError('Закупівлю не знайдено', 404);
      assertRevision(previous, req.body.revision);
      const items = previous.items.map(item => ({ ...item })), assetIds = [], keys = new Set();
      for (const entry of entries) {
        const assetId = D.identifier(entry.assetId), serial = D.required(entry.serial, 'IMEI'), key = `router:${serial.toLowerCase()}`;
        if (keys.has(key) || assetIds.includes(assetId)) throw new D.InputError('Повторний IMEI або позиція');
        keys.add(key); assetIds.push(assetId);
        if (await Asset.findOne({ key }).session(session).lean()) throw new D.InputError('Цей IMEI вже є на складі', 409);
        const asset = await Asset.findById(assetId).session(session).lean();
        const item = items.find(item => String(item.assetId) === assetId);
        if (!item || !asset || String(asset.purchaseId) !== id || asset.kind !== 'router' || asset.status !== 'available' || asset.serial) throw new D.InputError('IMEI можна додати лише до непроданого роутера без номера', 409);
        await Asset.updateOne({ _id: assetId }, { $set: { serial, key } }, { session });
        item.serial = serial;
      }
      const { _id, revisions, ...history } = previous;
      await Purchase.updateOne({ _id: id }, { $set: { items, revision: (previous.revision || 0) + 1 }, $push: { revisions: { ...history, changedAt: new Date().toISOString() } } }, { session });
      return { assetIds };
    });
    res.json(result);
  }));
  router.delete('/purchases/:id', route(async (req, res) => {
    const id = D.identifier(req.params.id);
    await transaction(async session => {
      const previous = await Purchase.findById(id).session(session).lean();
      if (!previous) throw new D.InputError('Закупівлю не знайдено', 404);
      if (previous.deletedAt) return;
      assertRevision(previous, req.body.revision);
      const assets = await Asset.find({ purchaseId: id, status: { $ne: 'void' } }).session(session).lean();
      if (assets.some(asset => asset.status === 'sold')) throw new D.InputError('Не можна видалити закупівлю, з якої вже продано обладнання або VPN-місця. Історія продажів має залишитися.', 409);
      for (const asset of assets) await Asset.updateOne({ _id: asset._id }, { $set: { status: 'void', originalKey: asset.key, key: `void:${asset._id}:${asset.key}` } }, { session });
      await Purchase.updateOne({ _id: id }, { $set: { deletedAt: new Date().toISOString(), revision: (previous.revision || 0) + 1 } }, { session });
    });
    res.json({ deleted: true });
  }));
  router.post('/expenses', route(async (req, res) => {
    const data = D.expense(req.body);
    const previous = await Expense.findById(data._id).lean();
    if (previous) return res.json(previous);
    res.status(201).json(await Expense.create(data));
  }));
  for (const [path, Model] of [['purchases', Purchase], ['expenses', Expense]]) {
    router.post(`/${path}/:id/payments`, route(async (req, res) => {
      const data = D.payment(req.body);
      const doc = await Model.findOneAndUpdate({ _id: req.params.id, deletedAt: { $exists: false }, 'payments.id': { $ne: data.id } }, { $push: { payments: data }, $inc: { revision: 1 } }, { new: true }) || await Model.findById(req.params.id);
      if (!doc) throw new D.InputError('Документ не знайдено', 404);
      if (doc.deletedAt) throw new D.InputError('Документ видалено', 404);
      res.status(201).json(doc);
    }));
  }
  function operationId(body) {
    const id = D.required(body.requestId, 'ідентифікатор операції');
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(id)) throw new D.InputError('Некоректний ідентифікатор операції');
    return id;
  }
  function orderData(body, number, user) {
    const date = D.date(body.date), legacy = D.legacyDate(date);
    const logistics = input => ({ date: input?.date ? D.legacyDate(D.date(input.date)) : legacy,
      logisticType: ['post', 'remote', 'meet'].includes(input?.logisticType) ? input.logisticType : 'remote',
      invoiceNumber: D.text(input?.invoiceNumber), invoicePrice: String(D.cents(input?.invoicePrice || 0, 'вартість доставки') / 100), comment: D.text(input?.comment) });
    return { _id: new mongoose.Types.ObjectId(), orderNumber: number, client: D.client(body.client),
      status: 'open', createdBy: { role: 'admin', id: user.id, name: user.name || 'Адміністратор' },
      income: logistics(body.income), outcome: logistics(body.outcome), payments: [], devices: [] };
  }
  router.post('/sales', route(async (req, res) => {
    const body = req.body, id = operationId(body);
    const previous = await Operation.findById(id).lean();
    if (previous) return res.json(await Orders.findById(previous.orderId));
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 500) throw new D.InputError('Виберіть від 1 до 500 товарів / VPN-місць');
    if (new Set(body.lines.map(l => l.assetId)).size !== body.lines.length) throw new D.InputError('Позиція повторюється у продажі');
    const order = orderData(body, await allocateNumber(), req.user);
    const services = D.list(body.services || []).map(D.serviceLine);
    const payments = D.list(body.payments || []).map(p => ({ amount: String(D.cents(p.amount) / 100), date: D.legacyDate(D.date(p.date)), paymentType: D.required(p.method, 'спосіб оплати') }));
    const result = await transaction(async session => {
      let costCents = 0; const devices = [];
      // Rechecked inside the transaction; simultaneous sales of the same unit cannot both commit.
      for (const line of body.lines) {
        const asset = D.available(await Asset.findById(D.identifier(line.assetId)).session(session).lean(), body.date);
        const sellCents = D.cents(line.amount, 'ціну продажу');
        const binding = asset.kind === 'router' ? { model: asset.name, serial: asset.serial } : {
          model: D.required(line.deviceModel, 'модель роутера для VPN'), serial: D.required(line.deviceSerial, 'серійний номер роутера для VPN'),
        };
        if (asset.kind === 'vpn-slot' && !binding.serial) throw new D.InputError('Для VPN-місця вкажіть серійний номер роутера');
        const history = { id: randomUUID(), action: 'sale', date: body.date, orderId: String(order._id), ...binding };
        const updated = await Asset.updateOne({ _id: asset._id, status: 'available' }, { $set: { status: 'sold', orderId: String(order._id),
          soldAt: body.date, saleCents: sellCents, client: order.client, binding }, $push: { history } }, { session });
        if (!updated.modifiedCount) throw new D.InputError('Позиція вже продана', 409);
        costCents += asset.costCents;
        devices.push({ id: randomUUID(), inventoryItemId: asset._id, lineKind: asset.kind === 'router' ? 'goods' : 'vpn',
          model: binding.model, imei: binding.serial, imeiInner: asset.kind === 'vpn-slot' ? asset.serial : '',
          service: asset.kind === 'router' ? 'Продаж' : 'Активація VPN', amount: String(sellCents / 100), complectation: asset.complectation || [] });
      }
      const data = { ...order, devices: [...devices, ...services], payments,
        commerce: { operationId: id, type: 'sale', date: body.date, costCents } };
      await Orders.create([data], { session });
      await Operation.create([{ _id: id, orderId: String(order._id), type: 'sale' }], { session });
      return data;
    });
    res.status(201).json(result);
  }));
  router.post('/transfers', route(async (req, res) => {
    const body = req.body, id = operationId(body);
    const previous = await Operation.findById(id).lean();
    if (previous) return res.json(await Orders.findById(previous.orderId));
    const date = D.date(body.date), model = D.required(body.model, 'модель нового роутера'), serial = D.required(body.serial, 'IMEI / серійний номер нового роутера');
    const number = await allocateNumber();
    const result = await transaction(async session => {
      const asset = await Asset.findById(D.identifier(body.assetId)).session(session).lean();
      if (!asset || asset.kind !== 'vpn-slot' || asset.status !== 'sold') throw new D.InputError('Можна перенести лише продане VPN-місце');
      if (asset.expiresAt < date) throw new D.InputError('Строк дії VPN закінчився');
      if (asset.soldAt > date) throw new D.InputError('Дата перенесення не може передувати продажу');
      if ((asset.history || []).some(h => h.date > date)) throw new D.InputError('Дата перенесення не може передувати останній зміні роутера');
      const order = orderData({ date, client: asset.client }, number, req.user);
      order.devices = [{ id: randomUUID(), inventoryItemId: asset._id, lineKind: 'service', model, imei: serial,
        imeiInner: asset.serial, service: 'Перенесення VPN', amount: '0', complectation: [] }];
      order.commerce = { operationId: id, type: 'transfer', date, costCents: 0 };
      const history = { id: randomUUID(), action: 'transfer', date, orderId: String(order._id), model, serial };
      await Asset.updateOne({ _id: asset._id }, { $set: { binding: { model, serial } }, $push: { history } }, { session });
      await Orders.create([order], { session });
      await Operation.create([{ _id: id, orderId: String(order._id), type: 'transfer' }], { session });
      return order;
    });
    res.status(201).json(result);
  }));
  return router;
}
module.exports = { createCommerceRouter };
