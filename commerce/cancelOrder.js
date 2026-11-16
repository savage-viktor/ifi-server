const { randomUUID } = require('crypto');
const D = require('./domain');
const linkedIds = order => [...new Set((order.devices || []).flatMap(device => [device.inventoryItemId, ...(device.services || []).map(service => service.inventoryItemId)]).filter(Boolean).map(String))];
async function cancelStockOrder({ id, Order, Asset, connection, user, initialOrder }) {
  if (user.role !== 'admin') throw new D.InputError('Доступно адміністратору', 403);
  const initial = initialOrder || await Order.findById(id).lean();
  if (!initial) throw new D.InputError('Заявку не знайдено', 404);
  if (initial.deletedAt) return initial;
  if (initial.commerce?.type === 'transfer') throw new D.InputError('Спочатку потрібно окремо скасувати перенесення VPN; звичайне видалення не змінює його історію.', 409);
  if (!linkedIds(initial).length) throw new D.InputError('У складській заявці немає позицій для повернення', 409);
  await Promise.all([Order.init(), Asset.init()]);
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session).lean();
      if (!order) throw new D.InputError('Заявку не знайдено', 404);
      if (order.deletedAt) { result = order; return; }
      const cancelledAt = new Date().toISOString();
      for (const assetId of linkedIds(order)) {
        const asset = await Asset.findById(assetId).session(session).lean();
        if (!asset || asset.status !== 'sold' || String(asset.orderId) !== String(id)) throw new D.InputError('Стан позицій уже змінився. Заявку не скасовано.', 409);
        const history = asset.history || [];
        const saleIndex = history.map(event => event.action === 'sale' && String(event.orderId) === String(id)).lastIndexOf(true);
        if (saleIndex < 0 || history.slice(saleIndex + 1).some(event => event.action === 'transfer')) throw new D.InputError('Після цього продажу VPN переносили. Автоматичне скасування заблоковано, щоб не втратити прив’язку.', 409);
        const updated = await Asset.updateOne({ _id: assetId, status: 'sold', orderId: String(id) }, {
          $set: { status: 'available', orderId: null, soldAt: null, saleCents: null, bundleTotalCents: null, client: null, binding: null },
          $push: { history: { id: randomUUID(), action: 'cancel-sale', date: cancelledAt.slice(0, 10), orderId: String(id), cancelledAt, actorId: user.id || 'admin' } },
        }, { session });
        if (!updated.modifiedCount) throw new D.InputError('Позицію вже змінили. Заявку не скасовано.', 409);
      }
      result = await Order.findOneAndUpdate({ _id: id }, { $set: { deletedAt: cancelledAt, cancellation: { actorId: user.id || 'admin', returnedAssetIds: linkedIds(order) } } }, { session, new: true });
    });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { cancelStockOrder, linkedIds };
