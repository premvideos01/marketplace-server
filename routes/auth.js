const express = require("express");
const rateLimit = require("express-rate-limit");
const { db } = require("../db");
const { hashPassword, verifyPassword, signToken, getUser, authMiddleware, bumpTokenVersion } = require("../auth");

const router = express.Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();

// Rate limits: brute-force and signup-spam mitigation
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many login attempts, try again in 15 minutes" }
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many signups from this IP, try again later" }
});

router.post("/signup", signupLimiter, async (req, res) => {
  const { email, password, username, display_name } = req.body || {};
  if (!email || !password || !username) return res.status(400).json({ error: "email, password, username required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) return res.status(400).json({ error: "username must be 3–24 chars, letters/digits/underscore/period" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "invalid email" });

  try {
    const hash = await hashPassword(password);
    const isAdmin = ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL ? 1 : 0;
    const info = db.prepare(
      "INSERT INTO users (email, username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)"
    ).run(email, username, display_name || username, hash, isAdmin);
    const user = getUser(info.lastInsertRowid);
    const token = signToken(user.id);
    res.json({ token, user });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "email or username already taken" });
    }
    console.error(e);
    res.status(500).json({ error: "signup failed" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const row = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
  if (!row) return res.status(401).json({ error: "invalid credentials" });
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });
  const user = getUser(row.id);
  const token = signToken(user.id);
  res.json({ token, user });
});

router.get("/me", authMiddleware(true), (req, res) => {
  res.json({ user: req.user });
});

// Invalidate every existing token for this user, including the one used to call this endpoint.
router.post("/logout-all", authMiddleware(true), (req, res) => {
  bumpTokenVersion(req.user.id);
  res.json({ ok: true });
});

// Change password — requires current password, bumps token_version (other sessions are kicked).
router.post("/change-password", authMiddleware(true), async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: "current_password and new_password required" });
  if (new_password.length < 8) return res.status(400).json({ error: "new password must be at least 8 characters" });
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "user not found" });
  const ok = await verifyPassword(current_password, row.password_hash);
  if (!ok) return res.status(401).json({ error: "current password incorrect" });
  const newHash = await hashPassword(new_password);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user.id);
  bumpTokenVersion(req.user.id);
  // Issue a fresh token so the caller stays signed in
  const token = signToken(req.user.id);
  res.json({ token, user: getUser(req.user.id) });
});

module.exports = router;
