const express = require("express");
const { db } = require("../db");
const { authMiddleware, premiumGate } = require("../auth");

const router = express.Router();

// Hooked from server.js to broadcast over WebSocket
let broadcast = () => {};
function bindBroadcast(fn) { broadcast = fn; }

// List my conversations with last message
router.get("/conversations", authMiddleware(true), (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
           buyer.username AS buyer_username, buyer.display_name AS buyer_name, buyer.avatar_url AS buyer_avatar,
           seller.username AS seller_username, seller.display_name AS seller_name, seller.avatar_url AS seller_avatar,
           l.title AS listing_title,
           (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
           (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
    FROM conversations c
    LEFT JOIN users buyer ON buyer.id = c.buyer_id
    LEFT JOIN users seller ON seller.id = c.seller_id
    LEFT JOIN listings l ON l.id = c.listing_id
    WHERE c.buyer_id = ? OR c.seller_id = ?
    ORDER BY COALESCE(last_at, c.created_at) DESC
  `).all(req.user.id, req.user.id, req.user.id);

  const me = req.user.id;
  rows.forEach(r => {
    r.other = r.buyer_id === me
      ? { id: r.seller_id, username: r.seller_username, name: r.seller_name, avatar: r.seller_avatar }
      : { id: r.buyer_id,  username: r.buyer_username,  name: r.buyer_name,  avatar: r.buyer_avatar };
    if (r.listing_id) {
      const photo = db.prepare("SELECT url FROM photos WHERE listing_id = ? ORDER BY position LIMIT 1").get(r.listing_id);
      r.listing_photo = photo ? photo.url : null;
    }
  });
  res.json({ conversations: rows });
});

// Messages in a conversation
router.get("/conversations/:id/messages", authMiddleware(true), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!conv) return res.status(404).json({ error: "not found" });
  if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) return res.status(403).json({ error: "not your conversation" });

  const msgs = db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500"
  ).all(id);

  // Mark messages from the other party as read
  db.prepare(
    "UPDATE messages SET read_at = strftime('%s','now') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL"
  ).run(id, req.user.id);

  res.json({ messages: msgs });
});

// Start (or reuse) a conversation about a listing + send first message
router.post("/conversations", authMiddleware(true), premiumGate("message"), (req, res) => {
  const { listing_id, body } = req.body || {};
  if (!listing_id || !body) return res.status(400).json({ error: "listing_id and body required" });
  const listing = db.prepare("SELECT id, user_id FROM listings WHERE id = ?").get(parseInt(listing_id, 10));
  if (!listing) return res.status(404).json({ error: "listing not found" });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: "can't message your own listing" });

  const buyerId = req.user.id;
  const sellerId = listing.user_id;

  let conv = db.prepare(
    "SELECT * FROM conversations WHERE listing_id = ? AND buyer_id = ? AND seller_id = ?"
  ).get(listing.id, buyerId, sellerId);

  if (!conv) {
    const info = db.prepare(
      "INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES (?, ?, ?)"
    ).run(listing.id, buyerId, sellerId);
    conv = { id: info.lastInsertRowid, listing_id: listing.id, buyer_id: buyerId, seller_id: sellerId };
  }

  const msgInfo = db.prepare(
    "INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)"
  ).run(conv.id, req.user.id, String(body).slice(0, 4000));

  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgInfo.lastInsertRowid);
  broadcast(sellerId === req.user.id ? buyerId : sellerId, { type: "message", message: msg, conversation_id: conv.id });
  res.json({ conversation: conv, message: msg });
});

// Send message to existing conversation
router.post("/messages", authMiddleware(true), premiumGate("message"), (req, res) => {
  const { conversation_id, body } = req.body || {};
  if (!conversation_id || !body) return res.status(400).json({ error: "conversation_id and body required" });
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(parseInt(conversation_id, 10));
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) return res.status(403).json({ error: "not your conversation" });

  const info = db.prepare(
    "INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)"
  ).run(conv.id, req.user.id, String(body).slice(0, 4000));
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
  broadcast(otherId, { type: "message", message: msg, conversation_id: conv.id });
  res.json({ message: msg });
});

module.exports = { router, bindBroadcast };
