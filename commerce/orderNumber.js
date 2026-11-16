const { Counter } = require('./models');
const Order = require('../models/orderModel');
// Shared by ordinary orders and stock sales. Reserving outside a sale transaction
// permits harmless gaps after a failed sale, but never duplicate numbers.
async function nextOrderNumber() {
  const last = await Order.find().sort({ orderNumber: -1 }).limit(1);
  const floor = Math.max(2700000, Number(last[0]?.orderNumber) || 0);
  try { await Counter.updateOne({ _id: 'orders' }, { $max: { value: floor } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const counter = await Counter.findOneAndUpdate({ _id: 'orders' }, { $inc: { value: 1 } }, { new: true });
  return counter.value;
}
module.exports = { nextOrderNumber };
