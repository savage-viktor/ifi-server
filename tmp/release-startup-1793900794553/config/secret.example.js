// Copy to secret.js on a new server; set long, distinct random values.
module.exports = {
  DB_PASSWORD: "your-existing-database-password",
  ADMIN_PASSWORD: "replace-with-a-long-admin-password",
  ADMIN_TOKEN: "replace-with-a-separate-random-api-key-for-postman",
  AUTH_TOKEN_SECRET: "replace-with-a-long-random-signing-key",
  EMAIL: {
    host: "smtp.ukr.net",
    port: 465,
    secure: true,
    auth: { user: "your-smtp-login", pass: "your-smtp-password" },
    from: "sender@example.com",
    to: "recipient@example.com",
  },
  WORKERS: [
    { id: "worker-1", login: "worker1", name: "Помічник 1", password: "replace-with-worker-password", enabled: true },
  ],
};
