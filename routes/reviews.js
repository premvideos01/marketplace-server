const express = require("express");
const { db } = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

// Submit a review (only after a completed booking, only buyer reviews seller)
router.post("/", authMiddleware(true), (req, res) => {
  const { booking_id, rating, comment } = req.body || {};
  const r = parseInt(rating, 10);
  if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: "rating must be 1-5" });
  if (!booking_id) return res.status(400).json({ error: "booking_id required" });

  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(parseInt(booking_id, 10));
  if (!b) return res.status(404).json({ error: "booking not found" });
  if (b.buyer_id !== req.user.id) return res.status(403).json({ error: "only the buyer can review" });
  if (b.status !== "completed") return res.status(400).json({ error: "booking must be completed before reviewing" });

  const exists = db.prepare("SELECT id FROM reviews WHERE booking_id = ? AND reviewer_id = ?").get(b.id, req.user.id);
  if (exists) return res.status(409).json({ error: "already reviewed" });

  const info = db.prepare(
    `INSERT INTO reviews (booking_id, listing_id, reviewer_id, reviewee_id, rating, comment)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(b.id, b.listing_id, req.user.id, b.seller_id, r, comment || null);
  const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(info.lastInsertRowid);
  res.json({ review: row });
});

// Reviews for a user (their reviews received)
router.get("/user/:userId", (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const rows = db.prepare(
    `SELECT r.id, r.rating, r.comment, r.created_at,
            u.username AS reviewer_username, u.display_name AS reviewer_name,
            l.title AS listing_title
     FROM reviews r
     JOIN users u    ON u.id = r.reviewer_id
     JOIN listings l ON l.id = r.listing_id
     WHERE r.reviewee_id = ?
     ORDER BY r.created_at DESC LIMIT 50`
  ).all(userId);
  const summary = db.prepare(
    "SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE reviewee_id = ?"
  ).get(userId);
  res.json({ reviews: rows, summary });
});

module.exports = router;
