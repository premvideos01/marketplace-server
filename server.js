// Load .env if present (no dependency on dotenv)
try {
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const { verifyToken, getUser } = require("./auth");

const app = express();
app.set("trust proxy", 1);  // honor X-Forwarded-For from Cloudflare so rate-limit sees real IPs
const PORT = parseInt(process.env.PORT || "3010", 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
if (allowedOrigins.length === 0 && process.env.NODE_ENV === "production") {
  console.error("FATAL: CORS_ORIGINS must be set in production (refusing default '*')");
  process.exit(1);
}

// Security headers — keep CSP off because we serve a frontend with inline event handlers; revisit later
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS not allowed for " + origin));
  },
  credentials: false
}));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

const messages = require("./routes/messages");
app.use("/api/auth", require("./routes/auth"));
app.use("/api/profile", require("./routes/profile"));
app.use("/api/listings", require("./routes/listings"));
app.use("/api/saved", require("./routes/saved"));
app.use("/api/uploads", require("./routes/uploads"));
app.use("/api", messages.router);
app.use("/api/admin", require("./routes/admin"));
app.use("/api/bookings", require("./routes/bookings"));
app.use("/api/reviews", require("./routes/reviews"));

app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

// Serve the static frontend (after API routes so /api/* still routes to handlers)
const FRONTEND_DIR = process.env.FRONTEND_DIR || "/Users/computer/.openclaw/workspace/marketplace-preview";
app.use(express.static(FRONTEND_DIR));
app.get(/^(?!\/api\/|\/uploads\/|\/health$).*$/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("ERR:", err.message);
  res.status(err.status || 500).json({ error: err.message });
});

const server = http.createServer(app);

// =================== WebSocket for realtime messages ===================
const wss = new WebSocketServer({ noServer: true });
const sockets = new Map(); // userId → Set<WebSocket>

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const payload = token ? verifyToken(token) : null;
  if (!payload) { socket.destroy(); return; }
  const user = getUser(payload.uid);
  if (!user) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.userId = user.id;
    if (!sockets.has(user.id)) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    ws.send(JSON.stringify({ type: "hello", user_id: user.id }));
    ws.on("close", () => {
      const set = sockets.get(user.id);
      if (set) { set.delete(ws); if (set.size === 0) sockets.delete(user.id); }
    });
  });
});

messages.bindBroadcast((userId, payload) => {
  const set = sockets.get(userId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    try { ws.send(msg); } catch {}
  }
});

server.listen(PORT, () => {
  console.log(`marketplace-server listening on :${PORT}`);
  console.log(`uploads dir: ${UPLOAD_DIR}`);
  console.log(`CORS origins: ${allowedOrigins.join(", ")}`);
});
