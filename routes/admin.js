const express = require("express");
const { db, getSetting, putSetting } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");

const router = express.Router();

router.use(authMiddleware(true), adminOnly);

router.get("/stats", (_req, res) => {
  const counts = {
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    premium_users: db.prepare("SELECT COUNT(*) c FROM users WHERE is_premium = 1").get().c,
    listings_active: db.prepare("SELECT COUNT(*) c FROM listings WHERE status = 'active'").get().c,
    listings_total: db.prepare("SELECT COUNT(*) c FROM listings").get().c,
    messages: db.prepare("SELECT COUNT(*) c FROM messages").get().c,
    conversations: db.prepare("SELECT COUNT(*) c FROM conversations").get().c,
    sign_ups_24h: db.prepare("SELECT COUNT(*) c FROM users WHERE created_at > strftime('%s','now') - 86400").get().c,
    listings_24h: db.prepare("SELECT COUNT(*) c FROM listings WHERE created_at > strftime('%s','now') - 86400").get().c,
  };
  res.json({ stats: counts, mode: getSetting("mode") });
});

router.get("/users", (req, res) => {
  const { q = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;
  const rows = db.prepare(
    `SELECT id, email, username, display_name, is_admin, is_premium, premium_until, created_at
     FROM users
     WHERE email LIKE ? OR username LIKE ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(`%${q}%`, `%${q}%`, lim, off);
  res.json({ users: rows });
});

router.put("/users/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { is_admin, is_premium, premium_until } = req.body || {};
  // Guard: admin cannot demote themselves (would risk locking everyone out if they're the only admin)
  if (id === req.user.id && is_admin !== undefined && !is_admin) {
    return res.status(400).json({ error: "cannot demote yourself; ask another admin to do it" });
  }
  db.prepare(
    "UPDATE users SET is_admin = COALESCE(?, is_admin), is_premium = COALESCE(?, is_premium), premium_until = COALESCE(?, premium_until) WHERE id = ?"
  ).run(
    is_admin === undefined ? null : (is_admin ? 1 : 0),
    is_premium === undefined ? null : (is_premium ? 1 : 0),
    premium_until === undefined ? null : premium_until,
    id
  );
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Guard: admin cannot delete themselves (FK cascade would wipe listings + cause self-lockout)
  if (id === req.user.id) {
    return res.status(400).json({ error: "cannot delete yourself; ask another admin" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.delete("/listings/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("DELETE FROM listings WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/settings", (_req, res) => {
  const all = db.prepare("SELECT key, value FROM settings").all();
  const obj = {};
  all.forEach(r => { obj[r.key] = r.value; });
  res.json({ settings: obj });
});

router.put("/settings", (req, res) => {
  const updates = req.body || {};
  for (const [k, v] of Object.entries(updates)) putSetting(k, v);
  res.json({ ok: true });
});

module.exports = router;
