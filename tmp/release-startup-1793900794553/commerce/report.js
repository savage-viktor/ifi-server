function iso(value) {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(value || '') ? `${value.slice(6)}-${value.slice(0, 2)}-${value.slice(3, 5)}` : '';
}
const amount = value => Math.round((Number(String(value || 0).replace(',', '.')) || 0) * 100);
function report({ orders, purchases, expenses, assets }, from = '', to = '', today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date())) {
  const inRange = d => Boolean(d) && (!from || d >= from) && (!to || d <= to);
  const result = { revenueCents: 0, costCents: 0, expensesCents: 0, receiptsCents: 0, paymentsCents: 0,
    customerDebtCents: 0, supplierDebtCents: 0, stockCents: 0, expiredVpnCents: 0,
    legacyUncostedRevenueCents: 0, goodsRevenueCents: 0, vpnRevenueCents: 0, serviceRevenueCents: 0, barterCents: 0 };
  orders.forEach(order => {
    const logistics = amount(order.income?.invoicePrice) + amount(order.outcome?.invoicePrice);
    const billed = (order.devices || []).reduce((s, d) => s + amount(d.amount), logistics);
    const paid = (order.payments || []).reduce((s, p) => s + amount(p.amount), 0);
    result.customerDebtCents += Math.max(0, billed - paid);
    result.supplierDebtCents += Math.max(0, paid - billed);
    const onDate = order.commerce?.date || iso(order.outcome?.date) || iso(order.income?.date);
    if (inRange(onDate)) {
      result.revenueCents += logistics;
      result.serviceRevenueCents += logistics;
      (order.devices || []).forEach(d => {
        const value = amount(d.amount);
        if (value < 0) return;
        result.revenueCents += value;
        const kind = d.lineKind === 'goods' ? 'goods' : d.lineKind === 'vpn' ? 'vpn' : 'service';
        result[`${kind}RevenueCents`] += value;
        if (!order.commerce && !order.vpnStock && /продаж|активація vpn/i.test(d.service || '')) result.legacyUncostedRevenueCents += value;
      });
      result.costCents += (order.commerce?.costCents || 0) + (order.inventoryCostCents || 0);
    }
    (order.payments || []).forEach(p => {
      if (!inRange(iso(p.date))) return;
      const value = amount(p.amount);
      if (/бартер/i.test(p.paymentType || '')) { result.barterCents += Math.abs(value); return; }
      if (value >= 0) result.receiptsCents += value; else result.paymentsCents -= value;
    });
  });
  for (const doc of [...purchases, ...expenses]) {
    const paid = (doc.payments || []).reduce((s, p) => s + settledUahCents(p, doc), 0);
    result.supplierDebtCents += Math.max(0, (doc.totalCents ?? doc.uahCents) - paid);
    (doc.payments || []).forEach(p => {
      if (!inRange(p.date)) return;
      if (/бартер/i.test(p.method || '')) result.barterCents += p.uahCents;
      else result.paymentsCents += p.uahCents;
    });
  }
  expenses.forEach(e => { if (inRange(e.date)) result.expensesCents += e.uahCents; });
  assets.filter(a => a.kind !== 'vpn-account' && a.status === 'available').forEach(a => {
    if (a.expiresAt && a.expiresAt < today) result.expiredVpnCents += a.costCents;
    else result.stockCents += a.costCents;
  });
  result.resultCents = result.revenueCents - result.costCents - result.expensesCents;
  result.cashCents = result.receiptsCents - result.paymentsCents;
  return result;
}
module.exports = { report, iso };
const { settledUahCents } = require('./domain');
