function normalizeDeviceServices(device) {
  if (!Array.isArray(device.services) || !device.services.length) return device;
  if (device.services.length > 30) throw new Error('Не більше 30 послуг на роутер');
  const services = device.services.map(entry => {
    if (!entry || typeof entry.name !== 'string' || entry.name.length > 500 || (entry.vpnId != null && (typeof entry.vpnId !== 'string' || entry.vpnId.length > 100))) throw new Error('Некоректні дані послуги');
    return { name: entry.name.trim(), vpnId: /VPN/i.test(entry.name) ? (entry.vpnId || '').trim() : '',
      ...(/VPN/i.test(entry.name) && entry.inventoryItemId ? { inventoryItemId: entry.inventoryItemId } : {}) };
  });
  return { ...device, services, service: services.map(entry => entry.name).filter(Boolean).join(', ') || null };
}
module.exports = { normalizeDeviceServices };
