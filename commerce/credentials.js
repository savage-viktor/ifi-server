const crypto = require('crypto');

function credentialStore(secretProvider) {
  const getKey = () => {
    const secret = secretProvider ? secretProvider() : process.env.COMMERCE_CREDENTIAL_KEY || process.env.AUTH_TOKEN_SECRET || require('../config/secret').AUTH_TOKEN_SECRET;
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('Configure COMMERCE_CREDENTIAL_KEY before saving VPN passwords');
    return crypto.createHash('sha256').update(secret).digest();
  };
  return {
    encrypt(password) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
      const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
      return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
    decrypt(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
module.exports = { credentialStore };
