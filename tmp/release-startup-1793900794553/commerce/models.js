const mongoose = require('mongoose');
const { Schema } = mongoose;
// Independent collections: no migration or reinterpretation of historical orders.
const flexible = fields => new Schema({ _id: String, ...fields }, { strict: false, timestamps: true });
const Purchase = mongoose.model('CommercePurchase', flexible({ supplier: String, date: String, payments: [Schema.Types.Mixed] }));
const Asset = mongoose.model('CommerceAsset', flexible({ key: { type: String, unique: true }, purchaseId: String,
  kind: String, status: String, accountId: String, orderId: String, history: [Schema.Types.Mixed] }));
const Expense = mongoose.model('CommerceExpense', flexible({ date: String, payments: [Schema.Types.Mixed] }));
const Operation = mongoose.model('CommerceOperation', flexible({ orderId: String, type: String }));
const Counter = mongoose.model('CommerceCounter', new Schema({ _id: String, value: Number }));
module.exports = { Purchase, Asset, Expense, Operation, Counter };
