function resolvePrice(services, device, client = {}) {
  const fullName = `${client.lastName || ""} ${client.firstName || ""}`.trim();
  const dropshipper = client.dropshipper?.label;
  const service = services.find(service => service.name === device.service);
  let general, dropPrice, clientPrice;
  for (const price of service?.prices || []) {
    if (!(price.models || []).includes(device.model)) continue;
    const clients = price.clients || [];
    const dropshippers = price.dropshippers || [];
    if (!clients.length && !dropshippers.length && general === undefined) general = price.amount;
    if (dropshipper && dropshippers.includes(dropshipper)) dropPrice = price.amount;
    if (fullName && clients.includes(fullName)) clientPrice = price.amount;
  }
  return clientPrice ?? dropPrice ?? general;
}

function clientKey(client = {}) {
  return JSON.stringify([client.lastName || "", client.firstName || "", client.dropshipper?.label || ""]);
}

function applyWorkerPricing(data, services, previous = null) {
  const result = { ...data };
  // Hidden payment history is maintained by the admin, never replaced by a stale worker form.
  if (previous) delete result.payments;
  else result.payments = [];
  const oldDevices = previous?.devices || [];
  const client = data.client || previous?.client || {};
  if (data.devices || (data.client && previous)) {
    result.devices = (data.devices || oldDevices).map(deviceDoc => {
      const device = require('./orderServices').normalizeDeviceServices(deviceDoc.toObject ? deviceDoc.toObject() : { ...deviceDoc });
      const old = oldDevices.find(item =>
        (device.id && (item.id === device.id || String(item._id) === device.id)) ||
        (device._id && String(item._id) === String(device._id)));
      const unchanged = old && old.model === device.model && old.service === device.service && clientKey(previous.client) === clientKey(client);
      const hasExistingPrice = unchanged && old.amount !== undefined && old.amount !== "" && Number(old.amount) !== 0;
      const price = hasExistingPrice ? old.amount : resolvePrice(services, device, client);
      device.amount = String(price ?? (unchanged ? old.amount ?? "0" : "0"));
      return device;
    });
  }
  return result;
}
module.exports = { resolvePrice, applyWorkerPricing };
