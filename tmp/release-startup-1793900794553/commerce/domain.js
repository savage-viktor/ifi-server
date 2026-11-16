const { randomUUID } = require('crypto');

class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = message => { throw new InputError(message); };
const text = value => typeof value === 'string' ? value.trim() : '';
function identifier(value) { const id = required(value, 'ідентифікатор'); if (!/^[a-zA-Z0-9_-]{10,100}$/.test(id)) fail('Некоректний ідентифікатор'); return id; }
function list(value, max = 500) { if (!Array.isArray(value) || value.length > max) fail(`Очікується список до ${max} позицій`); return value; }
function required(value, label) { const result = text(value); if (!result || result.length > 500) fail(`Вкажіть ${label} (до 500 символів)`); return result; }
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Некоректна дата');
  return value;
}
function cents(value, label = 'суму', allowZero = true) {
  const str = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(str)) fail(`Вкажіть ${label}: додатне число, до двох знаків після коми`);
  const result = Math.round(Number(str) * 100);
  if (!Number.isSafeInteger(result) || result > 1e12 || (!allowZero && !result)) fail(`Некоректна сума: ${label}`);
  return result;
}
function fx(currency, value) {
  if (!['UAH', 'USD'].includes(currency)) fail('Валюта має бути UAH або USD');
  if (currency === 'UAH') return 1;
  const rate = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(rate) || rate <= 0 || rate > 10000) fail('Вкажіть курс гривні за долар');
  return rate;
}
function money(value, currency, rate) {
  const amountCents = cents(value), exchangeRate = fx(currency, rate);
  const uahCents = Math.round(amountCents * exchangeRate);
  if (!Number.isSafeInteger(uahCents)) fail('Завелика сума');
  return { amountCents, currency, rate: exchangeRate, uahCents };
}
function payment(body) {
  const result = { id: body.id ? identifier(body.id) : randomUUID(), date: date(body.date), method: required(body.method, 'спосіб оплати'), ...money(body.amount, body.currency, body.rate) };
  if (!result.amountCents) fail('Платіж має бути більшим за нуль');
  if (body.settlementAmount !== undefined && body.settlementAmount !== '') result.settledOriginalCents = cents(body.settlementAmount, 'суму погашення');
  return result;
}
function settledUahCents(p, doc) {
  if (Number.isInteger(p.settledOriginalCents)) return Math.round(p.settledOriginalCents * doc.rate);
  return p.currency && p.currency === doc.currency ? Math.round(p.amountCents * doc.rate) : p.uahCents;
}
function split(total, count) { return Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0)); }
function purchase(body) {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 500) fail('Додайте від 1 до 500 позицій');
  const id = body.requestId ? identifier(body.requestId) : randomUUID(), currency = body.currency, rate = fx(currency, body.rate), acquiredAt = date(body.date);
  const credentials = [], assets = [], items = body.items.map((item, index) => {
    if (!['router', 'vpn-account'].includes(item.kind)) fail('Некоректний тип товару');
    const name = required(item.name, 'модель / назву'), serial = item.kind === 'router' && !text(item.serial) ? '' : required(item.serial, 'IMEI / серійний номер / email');
    const originalCents = cents(item.unitPrice, 'ціну закупівлі', false);
    const costCents = Math.round(originalCents * rate), assetId = randomUUID();
    if (!Number.isSafeInteger(costCents)) fail('Завелика сума');
    const expiresAt = item.kind === 'vpn-account' ? date(item.expiresAt) : undefined;
    if (expiresAt && expiresAt < acquiredAt) fail('Строк дії VPN не може завершуватися раніше закупівлі');
    const complectation = item.kind === 'router' ? list(item.complectation || [], 30).map(v => required(v, 'комплектацію')) : [];
    const subscriptionText = item.kind === 'vpn-account' ? text(item.subscriptionText) : '';
    const testId = item.kind === 'vpn-account' ? text(item.testId) : '';
    const base = { purchaseId: id, acquiredAt, name, serial, currency, rate, originalCents, costCents, status: 'available', history: [], complectation, subscriptionText };
    assets.push({ ...base, _id: assetId, kind: item.kind, key: serial ? `${item.kind}:${serial.toLowerCase()}` : `pending:${id}:${index}`, expiresAt, ...(item.kind === 'vpn-account' ? { testId } : {}) });
    let codes = [];
    if (item.kind === 'vpn-account') {
      if (item.password !== undefined && item.password !== '') {
        if (typeof item.password !== 'string' || item.password.length > 1000) fail('Некоректний пароль VPN');
        for (const key of ['serviceLogin', 'servicePassword']) if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 1000)) fail('Некоректні доступи підключення VPN');
        credentials.push({ assetId, login: text(item.login) || serial, password: item.password, serviceLogin: item.serviceLogin || '', servicePassword: item.servicePassword || '' });
        assets[assets.length - 1].hasCredentials = true;
      }
      const count = Number(item.slots ?? 9);
      if (!Number.isInteger(count) || count < 1 || count > 99) fail('Кількість VPN-місць: від 1 до 99');
      codes = Array.isArray(item.slotCodes) ? item.slotCodes.map(code => required(code, 'код місця')) : [];
      if (codes.length !== count) fail('Кількість кодів VPN має відповідати кількості місць');
      if (testId && codes.some(code => code.toLowerCase() === testId.toLowerCase())) fail('Тестовий ID не може бути місцем для продажу');
      const originalParts = split(originalCents, count), parts = split(costCents, count);
      codes.forEach((code, i) => assets.push({ ...base, _id: randomUUID(), kind: 'vpn-slot', accountId: assetId,
        accountEmail: serial, serial: code, key: `vpn-slot:${code.toLowerCase()}`, expiresAt,
        originalCents: originalParts[i], costCents: parts[i] }));
    }
    return { assetId, kind: item.kind, name, serial, originalCents, costCents, slots: codes.length, complectation, subscriptionText, ...(item.kind === 'vpn-account' ? { testId } : {}) };
  });
  if (new Set(assets.map(a => a.key)).size !== assets.length) fail('Є повторні серійні номери або коди VPN');
  const extraCents = cents(body.extraUah || 0, 'додаткові витрати');
  // Distribute incidental costs over sellable units; account rows are informational.
  const units = assets.filter(a => a.kind !== 'vpn-account'), extraParts = split(extraCents, units.length);
  units.forEach((asset, i) => { asset.costCents += extraParts[i]; });
  const payments = list(body.payments || []).map(payment);
  const supplierDetails = { phone: text(body.supplierDetails?.phone), city: text(body.supplierDetails?.city), comment: text(body.supplierDetails?.comment),
    clientType: body.supplierDetails?.clientType === 'retail' ? 'retail' : 'regular',
    lastName: typeof body.supplierDetails?.lastName === 'string' ? text(body.supplierDetails.lastName) : text(body.supplier), firstName: text(body.supplierDetails?.firstName) };
  const income = { logisticType: ['post', 'remote', 'meet'].includes(body.income?.logisticType) ? body.income.logisticType : 'remote',
    invoiceNumber: text(body.income?.invoiceNumber), invoicePrice: String(extraCents / 100), comment: text(body.income?.comment), date: acquiredAt };
  return { assets, credentials, document: { _id: id, supplier: required(body.supplier, 'постачальника'), supplierDetails, income, date: date(body.date),
    currency, rate, items, extraCents, totalOriginalCents: items.reduce((s, i) => s + i.originalCents, 0),
    totalCents: items.reduce((s, i) => s + i.costCents, extraCents), payments, note: text(body.note) } };
}
function expense(body) {
  return { _id: body.requestId ? identifier(body.requestId) : randomUUID(), date: date(body.date), category: required(body.category, 'категорію'),
    description: required(body.description, 'опис витрати'), ...money(body.amount, body.currency, body.rate),
    payments: list(body.payments || []).map(payment) };
}
function available(asset, onDate) {
  if (asset?.kind === 'router' && !text(asset.serial)) fail('Спочатку додайте IMEI роутера в закупівлі');
  if (!asset || asset.kind === 'vpn-account' || asset.status !== 'available') throw new InputError('Позиція вже продана або недоступна. Оновіть склад.', 409);
  if (asset.expiresAt && asset.expiresAt < onDate) fail('Строк дії VPN закінчився');
  if (asset.acquiredAt && asset.acquiredAt > onDate) fail('Продаж не може передувати надходженню на склад');
  return asset;
}
function legacyDate(iso) { return `${iso.slice(5, 7)}.${iso.slice(8, 10)}.${iso.slice(0, 4)}`; }
function client(body) {
  const result = Object.fromEntries(['firstName', 'lastName', 'phone', 'city'].map(k => [k, text(body?.[k])]));
  return { ...result, clientType: body?.clientType === 'regular' ? 'regular' : 'retail', isDropshipper: Boolean(body?.isDropshipper),
    dropshipper: text(body?.dropshipper?.label) ? { label: text(body.dropshipper.label) } : null };
}
function serviceLine(line) {
  return { id: randomUUID(), lineKind: 'service', model: text(line.model), imei: text(line.serial),
    service: required(line.name, 'назву послуги'), amount: String(cents(line.amount) / 100), complectation: [] };
}
module.exports = { InputError, text, required, identifier, list, date, cents, fx, money, payment, settledUahCents, split, purchase, expense, available, legacyDate, client, serviceLine };
