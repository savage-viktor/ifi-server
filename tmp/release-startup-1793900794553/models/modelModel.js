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
  services: [
    {
      name: String,
      page: String,
      isPage: Boolean,
      isOnSite: Boolean,
    },
  ],
  components: [],
});

const Model = mongoose.model("Model", modelSchema);

module.exports = Model;
