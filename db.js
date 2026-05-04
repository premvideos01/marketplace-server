const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "marketplace.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_premium INTEGER NOT NULL DEFAULT 0,
  premium_until INTEGER,
  zip TEXT,
  city TEXT,
  state TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  category TEXT NOT NULL,
  condition TEXT,
  description TEXT,
  zip TEXT,
  city TEXT,
  state TEXT,
  lat REAL,
  lng REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_photos_listing ON photos(listing_id, position);

CREATE TABLE IF NOT EXISTS saved (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(listing_id, buyer_id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_buyer ON conversations(buyer_id);
CREATE INDEX IF NOT EXISTS idx_conv_seller ON conversations(seller_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migration: add token_version to users (used for JWT revocation on logout-all / password change)
try { db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"); }
catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }

// Migration: add service-specific columns to listings (idempotent — ignore "duplicate column" errors)
const SERVICE_COLUMNS = [
  "subcategory TEXT",
  "pricing_model TEXT",        // 'hourly' | 'flat' | 'quote' | 'package'
  "service_area_radius INTEGER", // miles
  "availability TEXT",         // JSON: {days:[],hours:"9-17"}
  "years_experience INTEGER",
  "licensed INTEGER NOT NULL DEFAULT 0",
  "insured INTEGER NOT NULL DEFAULT 0",
  "bonded INTEGER NOT NULL DEFAULT 0",
];
for (const col of SERVICE_COLUMNS) {
  try { db.exec(`ALTER TABLE listings ADD COLUMN ${col}`); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}
// Useful index for subcategory browsing
try { db.exec("CREATE INDEX IF NOT EXISTS idx_listings_subcat ON listings(category, subcategory, created_at DESC)"); } catch {}

// Bookings: requests from buyers to service providers
db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_date INTEGER,
  message TEXT,
  agreed_price INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | completed | cancelled
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_seller ON bookings(seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_buyer ON bookings(buyer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_listing ON bookings(listing_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(booking_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id, created_at DESC);
`);

// Seed default settings
const setSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
setSetting.run("mode", "open"); // open | premium-post | premium-browse | premium-all
setSetting.run("site_name", "Hometown");

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function putSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

module.exports = { db, getSetting, putSetting };
