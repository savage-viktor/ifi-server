const mongoose = require("mongoose");

const contactUsSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  message: String,
  date: { type: Date, default: Date.now },
});

const ContactUs = mongoose.model("ContactUs", contactUsSchema);

module.exports = ContactUs;
