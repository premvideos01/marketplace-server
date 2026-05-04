const express = require("express");
const { db } = require("../db");
const { authMiddleware, premiumGate } = require("../auth");

const router = express.Router();

function attachPhotos(listings) {
  if (listings.length === 0) return listings;
  const ids = listings.map(l => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const photos = db.prepare(`SELECT listing_id, url, position FROM photos WHERE listing_id IN (${placeholders}) ORDER BY listing_id, position`).all(...ids);
  const byId = {};
  for (const l of listings) { l.photos = []; byId[l.id] = l; }
  for (const p of photos) byId[p.listing_id] && byId[p.listing_id].photos.push(p.url);
  return listings;
}

// Browse / search
router.get("/", premiumGate("browse"), (req, res) => {
  const { category, subcategory, section, q, max_price, sort = "newest", limit = 50, offset = 0 } = req.query;
  const where = ["l.status = 'active'"];
  const params = [];
  // Section is a coarse filter: sale = everything except services; services = only services
  if (section === "sale")          { where.push("l.category != 'services'"); }
  else if (section === "services") { where.push("l.category  = 'services'"); }
  if (category && category !== "all") { where.push("l.category = ?"); params.push(category); }
  if (subcategory)                    { where.push("l.subcategory = ?"); params.push(subcategory); }
  if (q) { where.push("(l.title LIKE ? OR l.description LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (max_price !== undefined) { where.push("l.price <= ?"); params.push(parseInt(max_price, 10)); }
  let order = "l.created_at DESC";
  if (sort === "price-asc") order = "l.price ASC";
  else if (sort === "price-desc") order = "l.price DESC";
  else if (sort === "rating")    order = "rating_avg DESC NULLS LAST, l.created_at DESC";
  const lim = Math.min(parseInt(limit, 10) || 50, 100);
  const off = parseInt(offset, 10) || 0;

  const rows = db.prepare(
    `SELECT l.*,
            u.username AS seller_username, u.display_name AS seller_name, u.is_premium AS seller_premium,
            (SELECT AVG(rating) FROM reviews r WHERE r.reviewee_id = u.id) AS rating_avg,
            (SELECT COUNT(*)   FROM reviews r WHERE r.reviewee_id = u.id) AS rating_count
     FROM listings l
     JOIN users u ON u.id = l.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`
  ).all(...params, lim, off);

  res.json({ listings: attachPhotos(rows) });
});

// Single listing (includes seller rating + recent reviews)
router.get("/:id", premiumGate("browse"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(
    `SELECT l.*,
            u.username AS seller_username, u.display_name AS seller_name, u.is_premium AS seller_premium, u.avatar_url AS seller_avatar,
            (SELECT AVG(rating) FROM reviews r WHERE r.reviewee_id = u.id) AS rating_avg,
            (SELECT COUNT(*)   FROM reviews r WHERE r.reviewee_id = u.id) AS rating_count
     FROM listings l JOIN users u ON u.id = l.user_id
     WHERE l.id = ?`
  ).get(id);
  if (!row) return res.status(404).json({ error: "not found" });
  attachPhotos([row]);
  // Include up to 5 recent reviews of the seller
  row.reviews = db.prepare(
    `SELECT r.rating, r.comment, r.created_at, u.username AS reviewer_username, u.display_name AS reviewer_name
     FROM reviews r JOIN users u ON u.id = r.reviewer_id
     WHERE r.reviewee_id = ?
     ORDER BY r.created_at DESC LIMIT 5`
  ).all(row.user_id);
  res.json({ listing: row });
});

// Create
router.post("/", authMiddleware(true), premiumGate("post"), (req, res) => {
  const {
    title, price, category, condition, description, zip, city, state, lat, lng, photo_urls,
    subcategory, pricing_model, service_area_radius, availability,
    years_experience, licensed, insured, bonded
  } = req.body || {};
  if (!title || price === undefined || !category) return res.status(400).json({ error: "title, price, category required" });

  const isService = category === "services";
  const availabilityJson = availability && typeof availability === "object" ? JSON.stringify(availability) : (availability || null);

  const insert = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO listings
        (user_id, title, price, category, condition, description, zip, city, state, lat, lng,
         subcategory, pricing_model, service_area_radius, availability,
         years_experience, licensed, insured, bonded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?)`
    ).run(
      req.user.id, title, parseInt(price, 10), category,
      condition || null, description || null,
      zip || null, city || null, state || null, lat || null, lng || null,
      isService ? (subcategory || null) : null,
      isService ? (pricing_model || null) : null,
      isService && service_area_radius != null ? parseInt(service_area_radius, 10) : null,
      isService ? availabilityJson : null,
      isService && years_experience != null ? parseInt(years_experience, 10) : null,
      isService ? (licensed ? 1 : 0) : 0,
      isService ? (insured  ? 1 : 0) : 0,
      isService ? (bonded   ? 1 : 0) : 0
    );
    const listingId = info.lastInsertRowid;
    if (Array.isArray(photo_urls)) {
      const pStmt = db.prepare("INSERT INTO photos (listing_id, url, position) VALUES (?, ?, ?)");
      photo_urls.forEach((url, i) => pStmt.run(listingId, url, i));
    }
    return listingId;
  });

  const id = insert();
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
  attachPhotos([row]);
  res.json({ listing: row });
});

const VALID_STATUSES = new Set(["active", "sold", "archived", "draft"]);

// Update own
router.put("/:id", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = db.prepare("SELECT user_id FROM listings WHERE id = ?").get(id);
  if (!owned) return res.status(404).json({ error: "not found" });
  if (owned.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: "not your listing" });

  const { title, price, category, condition, description, zip, city, state, status, photo_urls } = req.body || {};
  if (status !== undefined && status !== null && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` });
  }
  db.prepare(
    `UPDATE listings SET
       title = COALESCE(?, title),
       price = COALESCE(?, price),
       category = COALESCE(?, category),
       condition = COALESCE(?, condition),
       description = COALESCE(?, description),
       zip = COALESCE(?, zip),
       city = COALESCE(?, city),
       state = COALESCE(?, state),
       status = COALESCE(?, status)
     WHERE id = ?`
  ).run(title ?? null, price ?? null, category ?? null, condition ?? null, description ?? null, zip ?? null, city ?? null, state ?? null, status ?? null, id);

  if (Array.isArray(photo_urls)) {
    db.prepare("DELETE FROM photos WHERE listing_id = ?").run(id);
    const pStmt = db.prepare("INSERT INTO photos (listing_id, url, position) VALUES (?, ?, ?)");
    photo_urls.forEach((url, i) => pStmt.run(id, url, i));
  }
  res.json({ ok: true });
});

router.delete("/:id", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = db.prepare("SELECT user_id FROM listings WHERE id = ?").get(id);
  if (!owned) return res.status(404).json({ error: "not found" });
  if (owned.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: "not your listing" });
  db.prepare("DELETE FROM listings WHERE id = ?").run(id);
  res.json({ ok: true });
});

// My listings
router.get("/mine/all", authMiddleware(true), (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);
  res.json({ listings: attachPhotos(rows) });
});

module.exports = router;
