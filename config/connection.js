// Preserve legacy connection selection. Old .env files may contain an unused MONGO_URI.
module.exports = function getMongoUri() {
  if (process.env.USE_ENV_MONGO_URI === 'true') {
    if (!process.env.MONGO_URI) throw new Error('USE_ENV_MONGO_URI requires MONGO_URI');
    return process.env.MONGO_URI;
  }
  const secrets = require('./secret');
  const DB_PASSWORD = typeof secrets === 'string' ? secrets : secrets.DB_PASSWORD;
  return `mongodb+srv://viktordkn:${DB_PASSWORD}@cluster0.urb4ocq.mongodb.net/IFI-Service?retryWrites=true&w=majority`;
};
