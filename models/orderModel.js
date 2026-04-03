const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  orderNumber: Number,
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
      model: String,
      imei: String,
      imeiInner: String,
      service: String,
      comment: String,
      complectation: [],
      amount: String,
    },
  ],
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
