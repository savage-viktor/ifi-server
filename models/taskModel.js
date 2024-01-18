const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  text: {
    type: String,
    require: [true, "Task description is required"],
    unique: false,
  },
  isCompleted: {
    type: "boolean",
    default: false,
  },
});

const Task = mongoose.model("Task", taskSchema);

module.exports = Task;
