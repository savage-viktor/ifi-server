const mongoose = require("mongoose");

const paycontrolSchema = new mongoose.Schema({
  IMEI: Number,
  serialnum: Number,
  payStatus: String,
  deviceStatus: String,
});

const Paycontrol = mongoose.model("Paycontrol", paycontrolSchema);

module.exports = Paycontrol;
