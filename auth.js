const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { db, getSetting } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change-me-to-a-long-random-string") {
  console.warn("⚠️  JWT_SECRET is missing or default. Set a strong value in .env before going live.");
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

function signToken(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET || "dev-only-secret", { expiresIn: "30d" });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET || "dev-only-secret"); }
  catch { return null; }
}

function getUser(id) {
  return db.prepare("SELECT id, email, username, display_name, phone, avatar_url, is_admin, is_premium, premium_until, zip, city, state, created_at FROM users WHERE id = ?").get(id);
}

function authMiddleware(required = true) {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        req.user = getUser(payload.uid);
      }
    }
    if (required && !req.user) return res.status(401).json({ error: "auth required" });
    next();
  };
}

function adminOnly(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: "admin only" });
  next();
}

// Premium gating based on global mode
function premiumGate(action) {
  return (req, res, next) => {
    const mode = getSetting("mode") || "open";
    if (mode === "open") return next();
    const u = req.user;
    if (!u) return res.status(401).json({ error: "auth required" });
    if (u.is_admin) return next();
    const premiumActive = u.is_premium === 1 && (!u.premium_until || u.premium_until > Date.now() / 1000);

    const requiresPremium =
      mode === "premium-all" ||
      (mode === "premium-post" && (action === "post" || action === "message")) ||
      (mode === "premium-browse" && (action === "browse" || action === "post" || action === "message"));

    if (requiresPremium && !premiumActive) {
      return res.status(402).json({ error: "premium required", mode, action });
    }
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken,
  getUser, authMiddleware, adminOnly, premiumGate
};
