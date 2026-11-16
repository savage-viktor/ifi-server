const mongoose = require("mongoose");

const legalControlSchema = new mongoose.Schema({
  uniqnum: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{10,15}$/,  // ← 10–15 цифр
  },
  devicemodel: {
    type: String,
    required: true,
  },
firmware: {
  type: String,
  default: 'unknown',
  trim: true,
},
  vpnid: {
    type: String,
    trim: true,
    // безпечно: дозволяємо букви/цифри і кілька тех.символів, до 128
    match: /^[A-Za-z0-9._:\-]{1,128}$/,
  },
  deviceStatus: {
    type: String,
    required: true,
    default: 'normal', // змінюєш тільки ти адмін-ендпоінтом
    enum: ['normal', 'lock', 'locked', 'unlocked', 'idle', 'controlDisabled'],
  },
  requests: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

legalControlSchema.index({ uniqnum: 1 }, { unique: true });

const LegalControl = mongoose.model('LegalControl', legalControlSchema);

module.exports = LegalControl;