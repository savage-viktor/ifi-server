const mongoose = require("mongoose");
const commerceSchema = new mongoose.Schema({
  operationId: String,
  type: String,
  date: String,
  costCents: Number,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: Number,
  createdBy: {
    role: { type: String, enum: ["admin", "worker"] },
    id: String,
    name: String,
  },
  status: { type: String, enum: ["open", "closed"], default: "open" },
  closedAt: { type: Date, default: null },
  vpnStock: Boolean,
  inventoryCostCents: Number,
  deletedAt: { type: Date, default: undefined },
  cancellation: mongoose.Schema.Types.Mixed,
  commerce: { type: commerceSchema, default: undefined },
  client: {
    city: String,
    clientType: String,
    dropshipper: {
      label: String,
    },
    isDropshipper: Boolean,
    firstName: String,
    lastName: String,
    phone: String,
  },
  income: {
    logisticType: String,
    invoiceNumber: String,
    invoicePrice: String,
    comment: String,
    date: String,
  },
  outcome: {
    logisticType: String,
    invoiceNumber: String,
    invoicePrice: String,
    comment: String,
    date: String,
  },
  payments: [
    {
      amount: String,
      date: String,
      paymentType: String,
    },
  ],
  devices: [
    {
      id: String,
      inventoryItemId: String,
      lineKind: { type: String, enum: ['goods', 'vpn', 'service'] },
      model: String,
      imei: String,
      imeiInner: String,
      service: String,
      services: [{ _id: false, name: String, vpnId: String, inventoryItemId: String }],
      comment: String,
      complectation: [],
      amount: String,
    },
  ],
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
