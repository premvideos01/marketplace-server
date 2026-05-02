const express = require("express");
const { db } = require("../db");
const { authMiddleware, getUser } = require("../auth");

const router = express.Router();

router.get("/me", authMiddleware(true), (req, res) => {
  res.json({ user: req.user });
});

router.put("/me", authMiddleware(true), (req, res) => {
  const { display_name, phone, avatar_url, zip, city, state } = req.body || {};
  db.prepare(
    "UPDATE users SET display_name = COALESCE(?, display_name), phone = COALESCE(?, phone), avatar_url = COALESCE(?, avatar_url), zip = COALESCE(?, zip), city = COALESCE(?, city), state = COALESCE(?, state) WHERE id = ?"
  ).run(display_name ?? null, phone ?? null, avatar_url ?? null, zip ?? null, city ?? null, state ?? null, req.user.id);
  res.json({ user: getUser(req.user.id) });
});

router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare(
    "SELECT id, username, display_name, avatar_url, is_premium, created_at FROM users WHERE id = ?"
  ).get(id);
  if (!user) return res.status(404).json({ error: "not found" });
  const stats = db.prepare(
    "SELECT COUNT(*) as count FROM listings WHERE user_id = ? AND status = 'active'"
  ).get(id);
  res.json({ user, active_listings: stats.count });
});

module.exports = router;
