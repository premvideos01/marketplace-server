const express = require("express");
const { db } = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

// Create a booking request (buyer → seller)
router.post("/", authMiddleware(true), (req, res) => {
  const { listing_id, service_date, message, agreed_price } = req.body || {};
  if (!listing_id) return res.status(400).json({ error: "listing_id required" });

  const listing = db.prepare("SELECT id, user_id, category FROM listings WHERE id = ? AND status = 'active'").get(parseInt(listing_id, 10));
  if (!listing) return res.status(404).json({ error: "listing not found" });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: "cannot book your own listing" });
  if (listing.category !== "services") return res.status(400).json({ error: "bookings only apply to service listings" });

  const info = db.prepare(
    `INSERT INTO bookings (listing_id, buyer_id, seller_id, service_date, message, agreed_price)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    listing.id, req.user.id, listing.user_id,
    service_date ? parseInt(service_date, 10) : null,
    message || null,
    agreed_price != null ? parseInt(agreed_price, 10) : null
  );
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
  res.json({ booking: row });
});

// Update booking status (seller accepts/declines/completes; buyer cancels)
router.patch("/:id", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, agreed_price, service_date } = req.body || {};
  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
  if (!b) return res.status(404).json({ error: "not found" });

  const isSeller = b.seller_id === req.user.id;
  const isBuyer  = b.buyer_id  === req.user.id;
  if (!isSeller && !isBuyer && !req.user.is_admin) return res.status(403).json({ error: "forbidden" });

  // Status transition guard
  const allowed = {
    pending:   { seller: ["accepted","declined"], buyer: ["cancelled"] },
    accepted:  { seller: ["completed","cancelled"], buyer: ["cancelled"] },
    declined:  { seller: [], buyer: [] },
    completed: { seller: [], buyer: [] },
    cancelled: { seller: [], buyer: [] },
  };
  if (status) {
    const role = isSeller ? "seller" : "buyer";
    if (!(allowed[b.status]?.[role] || []).includes(status) && !req.user.is_admin) {
      return res.status(400).json({ error: `cannot transition ${b.status} → ${status} as ${role}` });
    }
  }

  db.prepare(
    `UPDATE bookings SET
       status        = COALESCE(?, status),
       agreed_price  = COALESCE(?, agreed_price),
       service_date  = COALESCE(?, service_date),
       updated_at    = strftime('%s','now')
     WHERE id = ?`
  ).run(
    status || null,
    agreed_price != null ? parseInt(agreed_price, 10) : null,
    service_date != null ? parseInt(service_date, 10) : null,
    id
  );
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
  res.json({ booking: row });
});

// My bookings (as buyer or as seller)
router.get("/mine", authMiddleware(true), (req, res) => {
  const role = req.query.role === "seller" ? "seller_id" : "buyer_id";
  const rows = db.prepare(
    `SELECT b.*, l.title AS listing_title, l.subcategory, l.pricing_model,
            buyer.username AS buyer_username, buyer.display_name AS buyer_name,
            seller.username AS seller_username, seller.display_name AS seller_name
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN users buyer  ON buyer.id  = b.buyer_id
     JOIN users seller ON seller.id = b.seller_id
     WHERE b.${role} = ?
     ORDER BY b.created_at DESC`
  ).all(req.user.id);
  res.json({ bookings: rows });
});

module.exports = router;
