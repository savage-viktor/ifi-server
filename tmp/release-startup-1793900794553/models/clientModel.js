const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({
  firstName: {
    type: String,
    require: [true, "Firstname is required"],
  },
  lastName: {
    type: String,
    require: [true, "Lastname is required"],
  },
  city: {
    type: String,
    require: [true, "City is required"],
  },
  phone: {
    type: String,
    require: [true, "Phone is required"],
  },
  login: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    select: false,
  },
});

const Client = mongoose.model("Client", clientSchema);

module.exports = Client;