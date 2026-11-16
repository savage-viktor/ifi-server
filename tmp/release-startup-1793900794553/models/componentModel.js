const mongoose = require("mongoose");

const componentSchema = new mongoose.Schema({
  type: {
    type: String,
    require: [true, "Необхідно ввести тип компонента"],
  },
  mark: {
    type: String,
    require: [true, "Необхідно ввести маркування компонента"],
    unique: true,
  },
  image: String,
  coment: String,
  size: String,
  flashMemory: Number,
  flashSpeed: Number,
  flashType: String,
  dataSheetURL: String,
  batteryCapacity: Number,
});

const Component = mongoose.model("Component", componentSchema);

module.exports = Component;
