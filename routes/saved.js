const express = require("express");
const { db } = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

router.get("/", authMiddleware(true), (req, res) => {
  const rows = db.prepare(
    `SELECT l.*, s.created_at AS saved_at
     FROM saved s JOIN listings l ON l.id = s.listing_id
     WHERE s.user_id = ? AND l.status = 'active'
     ORDER BY s.created_at DESC`
  ).all(req.user.id);
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const photos = db.prepare(`SELECT listing_id, url FROM photos WHERE listing_id IN (${ids.map(() => "?").join(",")}) ORDER BY position`).all(...ids);
    const byId = {};
    rows.forEach(r => { r.photos = []; byId[r.id] = r; });
    photos.forEach(p => byId[p.listing_id] && byId[p.listing_id].photos.push(p.url));
  }
  res.json({ listings: rows });
});

router.post("/:id", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("INSERT OR IGNORE INTO saved (user_id, listing_id) VALUES (?, ?)").run(req.user.id, id);
  res.json({ ok: true });
});

router.delete("/:id", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("DELETE FROM saved WHERE user_id = ? AND listing_id = ?").run(req.user.id, id);
  res.json({ ok: true });
});

module.exports = router;
