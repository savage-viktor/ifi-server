const { randomUUID } = require('crypto');
const D = require('./domain');
const { iso } = require('./report');
const selections = order => (order.devices || []).flatMap(device => (device.services || []).filter(service => service.inventoryItemId).map(service => ({ device, service })));
async function saveServiceStock({ data, previous = null, user, Asset, Order, connection }) {
  if (user.role !== 'admin') throw new D.InputError('Вибір місць зі складу доступний адміністратору', 403);
  await Promise.all([Asset.init(), Order.init()]);
  const session = await connection.startSession();
  try {
    let saved;
    await session.withTransaction(async () => {
      const current = previous ? await Order.findById(String(previous._id)).session(session).lean() : null;
      if (previous && !current) throw new D.InputError('Заявку не знайдено', 404);
      const order = { ...(current || data), ...data, devices: data.devices || current?.devices || [] };
      const oldEntries = selections(current || {}), entries = selections(order), ids = new Set();
      const date = D.date(iso(order.outcome?.date) || iso(order.income?.date));
      for (const old of oldEntries) {
        const next = entries.find(entry => entry.service.inventoryItemId === old.service.inventoryItemId);
        if (!next || next.device.id !== old.device.id || next.device.model !== old.device.model || next.device.imei !== old.device.imei) throw new D.InputError('Продане VPN-місце не можна прибрати або перенести редагуванням заявки. Скористайтесь перенесенням VPN.', 409);
      }
      let cost = 0;
      for (const { device, service } of entries) {
        const id = D.identifier(service.inventoryItemId);
        if (ids.has(id)) throw new D.InputError('VPN-місце повторюється у заявці');
        ids.add(id);
        const asset = await Asset.findById(id).session(session).lean();
        if (!asset || asset.kind !== 'vpn-slot') throw new D.InputError('VPN-місце не знайдено', 404);
        const already = oldEntries.some(entry => entry.service.inventoryItemId === id);
        if (already) {
          if (String(asset.orderId) !== String(order._id) || asset.status !== 'sold') throw new D.InputError('Стан VPN-місця вже змінився', 409);
          const total = D.cents(device.amount, 'суму послуг'), isBundle = (device.services || []).filter(s => s.name).length > 1;
          await Asset.updateOne({ _id: id }, { $set: { client: order.client, saleCents: isBundle ? null : total, bundleTotalCents: isBundle ? total : null } }, { session });
        } else {
          D.available(asset, date);
          const binding = { model: D.required(device.model, 'модель роутера'), serial: D.required(device.imei, 'IMEI роутера') };
          const total = D.cents(device.amount, 'суму послуг');
          const isBundle = (device.services || []).filter(s => s.name).length > 1;
          const updated = await Asset.updateOne({ _id: id, status: 'available' }, { $set: { status: 'sold', orderId: String(order._id), soldAt: date,
            client: order.client, binding, saleCents: isBundle ? null : total, bundleTotalCents: isBundle ? total : null },
            $push: { history: { id: randomUUID(), action: 'sale', date, orderId: String(order._id), ...binding } } }, { session });
          if (!updated.modifiedCount) throw new D.InputError('VPN-місце вже продане', 409);
        }
        service.vpnId = asset.serial;
        cost += asset.costCents || 0;
      }
      order.vpnStock = true; order.inventoryCostCents = cost;
      if (current) {
        const { _id, __v, ...fields } = order;
        saved = await Order.findOneAndUpdate({ _id }, { $set: fields }, { session, new: true, runValidators: true });
      } else { saved = (await Order.create([order], { session }))[0]; }
    });
    return saved;
  } finally { await session.endSession(); }
}
module.exports = { saveServiceStock, selections };
