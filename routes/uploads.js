const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const FileType = require("file-type");
const { authMiddleware } = require("../auth");

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || "10", 10);
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Buffer files in memory so we can validate magic bytes + resize before writing.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("only images allowed"));
    cb(null, true);
  }
});

router.post("/", authMiddleware(true), upload.array("files", 8), async (req, res) => {
  const out = [];
  try {
    for (const f of req.files || []) {
      // 1. Verify magic-bytes match an allowed image type (mimetype is client-controlled and not trusted)
      const ft = await FileType.fromBuffer(f.buffer);
      if (!ft || !ALLOWED_MIMES.has(ft.mime)) {
        return res.status(415).json({ error: `unsupported or disguised image type: ${ft?.mime || "unknown"}` });
      }
      // 2. Decode + downscale to max 1600px wide; write optimized JPEG + 400px square thumb
      const id = `${Date.now()}-${req.user.id}-${Math.random().toString(36).slice(2, 8)}`;
      const fullName = `${id}.jpg`;
      const thumbName = `${id}-thumb.jpg`;
      const fullPath = path.join(UPLOAD_DIR, fullName);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);

      await sharp(f.buffer, { failOn: "error" })
        .rotate()                                                  // honor EXIF orientation
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(fullPath);
      await sharp(f.buffer, { failOn: "error" })
        .rotate()
        .resize({ width: 400, height: 400, fit: "cover" })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(thumbPath);

      out.push({
        url: `${PUBLIC_URL}/uploads/${fullName}`,
        thumb_url: `${PUBLIC_URL}/uploads/${thumbName}`
      });
    }
    // Backwards compat: keep `urls` as a string array; expose richer detail under `photos`
    res.json({ urls: out.map(o => o.url), photos: out });
  } catch (e) {
    console.error("upload error:", e.message);
    res.status(400).json({ error: `upload failed: ${e.message}` });
  }
});

module.exports = router;
