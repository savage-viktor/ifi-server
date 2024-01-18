const mongoose = require("mongoose");

const DB_PASSWORD = require("./secret");
const URI = `mongodb+srv://viktordkn:${DB_PASSWORD}@cluster0.urb4ocq.mongodb.net/IFI-Service?retryWrites=true&w=majority`;

mongoose
  .connect(URI)
  .then((res) => console.log("Connected to MongoDB"))
  .catch((error) => console.log(error));
