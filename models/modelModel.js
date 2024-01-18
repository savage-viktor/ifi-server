const mongoose = require("mongoose");

const modelSchema = new mongoose.Schema({
  vendor: {
    type: String,
    require: [true, "Task description is required"],
  },
  model: {
    type: String,
    require: [true, "Task description is required"],
    unique: true,
  },
  image: String,
  services: [
    {
      label: String,
      value: String,
      page: String,
      id: String,
      isPage: Boolean,
    },
  ],
  details: {
    typeOfSim: String,
    size: String,
    battery: String,
    bands: String,
    antena: String,
    wifi: String,
    mobileNetwork: String,
    type: { type: String },
  },

  components: [],
});

const Model = mongoose.model("Model", modelSchema);

module.exports = Model;
