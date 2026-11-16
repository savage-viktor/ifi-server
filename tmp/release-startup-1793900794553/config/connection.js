// Preserve the existing deployment address; MONGO_URI can override it on the host.
module.exports = function getMongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const secrets = require('./secret');
  const DB_PASSWORD = process.env.DB_PASSWORD || (typeof secrets === 'string' ? secrets : secrets.DB_PASSWORD);
  return `mongodb+srv://viktordkn:${DB_PASSWORD}@cluster0.urb4ocq.mongodb.net/IFI-Service?retryWrites=true&w=majority`;
};
