const mongoose = require('mongoose');
const getMongoUri = require('./connection');
mongoose.connect(getMongoUri())
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.error('MongoDB connection failed:', error.code || error.name));
