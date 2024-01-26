const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    require: [true, "Name is required"],
    unique: true,
  },
  page: {
    type: String,
    require: [true, "Page is required"],
    unique: true,
  },
  prices: [
    {
      amount: {
        type: Number,
        require: [true, "Amount is required"],
      },
      comment: String,
      models: [],
      clients: [],
      dropshippers: [],
    },
  ],
});

const Service = mongoose.model("Service", serviceSchema);

module.exports = Service;
