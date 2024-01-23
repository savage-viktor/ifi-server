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
});

const Client = mongoose.model("Client", clientSchema);

module.exports = Client;
