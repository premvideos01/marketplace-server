const express = require("express");
const { db } = require("../db");
const { hashPassword, verifyPassword, signToken, getUser, authMiddleware } = require("../auth");

const router = express.Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();

router.post("/signup", async (req, res) => {
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

router.post("/login", async (req, res) => {
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

module.exports = router;
