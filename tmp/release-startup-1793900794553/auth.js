const crypto = require("crypto");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createAuth(config) {
  const adminPassword = process.env.ADMIN_PASSWORD || config.ADMIN_PASSWORD;
  const adminKey = process.env.ADMIN_TOKEN || config.ADMIN_TOKEN;
  const signingKey = process.env.AUTH_TOKEN_SECRET || config.AUTH_TOKEN_SECRET;
  const workers = config.WORKERS || [];
  const ttl = 12 * 60 * 60 * 1000;
  const attempts = new Map();

  function sign(identity) {
    const payload = Buffer.from(JSON.stringify({ ...identity, exp: Date.now() + ttl })).toString("base64url");
    const signature = crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  function identify(req) {
    const token = req.get("X-Admin-Token") || (req.get("Authorization") || "").replace(/^Bearer /, "");
    if (adminKey && safeEqual(token, adminKey)) return { role: "admin", id: "admin" };
    if (!signingKey || !token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const signature = crypto.createHmac("sha256", signingKey).update(parts[0]).digest("base64url");
    if (!safeEqual(parts[1], signature)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
      if (payload.role === "admin" && payload.id === "admin") return payload;
      if (payload.role === "worker" && workers.some(w => w.id === payload.id && w.enabled !== false)) return payload;
    } catch (_) { /* Invalid token. */ }
    return null;
  }

  function login(role) {
    return (req, res) => {
      if (!signingKey || (role === "admin" && !adminPassword)) return res.status(503).json({ error: "auth_not_configured" });
      const key = `${req.ip}:${role}`;
      const now = Date.now();
      // Bound storage and expire inactive entries.
      for (const [ip, record] of attempts) if (record.until <= now) attempts.delete(ip);
      const record = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      if (record.count >= 10) return res.status(429).json({ error: "too_many_attempts" });
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const worker = role === "worker" && workers.find(w => w.enabled !== false && w.login === req.body?.login && w.password && safeEqual(password, w.password));
      if (!password || (role === "admin" ? !safeEqual(password, adminPassword) : !worker)) {
        record.count++;
        if (attempts.size < 10000 || attempts.has(key)) attempts.set(key, record);
        return res.status(401).json({ error: "invalid_credentials" });
      }
      attempts.delete(key);
      const user = { role, id: role === "admin" ? "admin" : worker.id, name: role === "admin" ? "Адміністратор" : worker.name };
      res.set("Cache-Control", "no-store");
      return res.json({ token: sign(user), user, expiresAt: now + ttl });
    };
  }

  function requireAdmin(req, res, next) {
    req.user = identify(req);
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
  }

  function gate(req, res, next) {
    const path = req.path.replace(/\/+$/, "") || "/";
    const publicRoute =
      (req.method === "GET" && /^\/models(?:\/[^/]+)?$/i.test(path)) ||
      (req.method === "POST" && path.toLowerCase() === "/contactus") ||
      (req.method === "POST" && path.toLowerCase() === "/legalcontrol") ||
      /^\/client(?:\/|$)/i.test(path);
    if (publicRoute) return next();
    req.user = identify(req);
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    res.set("Cache-Control", "no-store");
    if (req.user.role === "admin") return next();
    const readCatalog = req.method === "GET" && /^\/(services|components|clients)(?:\/[^/]+)?$/i.test(path);
    const orderAccess = (req.method === "GET" || req.method === "PUT") && /^\/orders(?:\/[^/]+)?$/i.test(path);
    if (readCatalog || orderAccess || (req.method === "POST" && path.toLowerCase() === "/orders")) return next();
    return res.status(403).json({ error: "forbidden" });
  }
  return { login, gate, requireAdmin, identify };
}

module.exports = { createAuth, safeEqual };
