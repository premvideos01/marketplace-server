const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authMiddleware } = require("../auth");

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || "10", 10);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 6) || ".jpg";
    const safeExt = /^\.(jpg|jpeg|png|webp|gif|heic)$/.test(ext) ? ext : ".jpg";
    const name = `${Date.now()}-${req.user.id}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("only images allowed"));
    cb(null, true);
  }
});

router.post("/", authMiddleware(true), upload.array("files", 8), (req, res) => {
  const urls = (req.files || []).map(f => `${PUBLIC_URL}/uploads/${f.filename}`);
  res.json({ urls });
});

module.exports = router;
