# Marketplace Server

Backend for the Hometown local marketplace — Node.js + Express + SQLite + WebSocket.
Single binary, no external services, deploys anywhere Node runs.

## Features

- **Auth**: signup / login with email + username + password (bcrypt + JWT, 30-day token)
- **Listings**: CRUD with photos, search, filter, sort
- **Photo uploads**: multipart, served as static files
- **Saved / favorites**: per-user
- **Messaging**: conversations + messages with WebSocket realtime
- **Admin**: stats, user management, premium grants, global mode switch
- **Premium gating**: admin can switch between `open` / `premium-post` /
  `premium-browse` / `premium-all` at any time

## Quick start (local)

```bash
git clone https://github.com/premvideos01/marketplace-server
cd marketplace-server
npm install
cp .env.example .env
# edit .env — set JWT_SECRET to a long random string and ADMIN_EMAIL to your email
npm start
```

Server runs on `http://localhost:3010`. The first user who signs up with the
`ADMIN_EMAIL` becomes the admin automatically.

## Environment variables

| Var | Required | Default | What it does |
|---|---|---|---|
| `JWT_SECRET` | yes | — | Long random string for signing session tokens. |
| `ADMIN_EMAIL` | yes | — | First account that signs up with this email becomes admin. |
| `PORT` | no | `3010` | HTTP port. |
| `DB_PATH` | no | `./marketplace.db` | SQLite file path. Mount a volume here in production. |
| `UPLOAD_DIR` | no | `./uploads` | Where photos go. Mount a volume here in production. |
| `PUBLIC_URL` | no | `http://localhost:3010` | Used to build photo URLs. Set to your public origin in production. |
| `CORS_ORIGINS` | no | `*` | Comma-separated list of allowed origins (your frontend URL). |
| `MAX_UPLOAD_MB` | no | `10` | Max photo size in MB. |

## Deploy

Anywhere Node 20+ runs. Three common paths:

### 1. Fly.io (free tier, has persistent volumes)

```bash
fly launch --no-deploy
fly volumes create marketplace_data --size 1
# In fly.toml, mount the volume to /data
# In fly.toml [env], set:
#   DB_PATH = "/data/marketplace.db"
#   UPLOAD_DIR = "/data/uploads"
#   PUBLIC_URL = "https://YOUR-APP.fly.dev"
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" ADMIN_EMAIL="you@example.com"
fly deploy
```

### 2. Render.com (paid, $7/mo for persistent disk)

Connect this repo. Render reads `Dockerfile` automatically.
Add env vars in the Render dashboard. Add a 1GB persistent disk
mounted at `/data`, then set `DB_PATH=/data/marketplace.db` and
`UPLOAD_DIR=/data/uploads`.

### 3. VPS (Hetzner / DigitalOcean / Linode, $4–6/mo)

```bash
ssh you@your.vps
git clone https://github.com/premvideos01/marketplace-server
cd marketplace-server
npm install
cp .env.example .env
nano .env  # set JWT_SECRET and ADMIN_EMAIL
# Run with systemd, pm2, or:
nohup node server.js > server.log 2>&1 &
```

Put nginx or Caddy in front for HTTPS + your custom domain.

### Docker (any host)

```bash
docker build -t marketplace-server .
docker run -d -p 3010:3010 \
  -v $(pwd)/data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_EMAIL="you@example.com" \
  -e PUBLIC_URL="https://your.domain.com" \
  -e CORS_ORIGINS="https://premvideos01.github.io" \
  --restart unless-stopped \
  marketplace-server
```

## Backups

SQLite database lives at `DB_PATH`. Back it up daily:

```bash
sqlite3 /data/marketplace.db ".backup /data/backups/marketplace-$(date +%Y%m%d).db"
```

Or use the included script (TODO) once you're in production.

## API summary

All routes return JSON. Auth via `Authorization: Bearer <token>` header.

```
POST   /api/auth/signup          { email, password, username, display_name? } → { token, user }
POST   /api/auth/login           { email, password } → { token, user }
GET    /api/auth/me              → { user }

GET    /api/profile/me           → { user }
PUT    /api/profile/me           → update own profile
GET    /api/profile/:id          → public profile

GET    /api/listings             ?category=&q=&max_price=&sort=&limit=&offset=
GET    /api/listings/:id
POST   /api/listings             create
PUT    /api/listings/:id         update own
DELETE /api/listings/:id         delete own (admin can delete any)
GET    /api/listings/mine/all    my own listings

POST   /api/uploads              multipart files[] → { urls: [...] }

GET    /api/saved                my saved listings
POST   /api/saved/:id            save
DELETE /api/saved/:id            unsave

GET    /api/conversations        my conversations
GET    /api/conversations/:id/messages
POST   /api/conversations        { listing_id, body }  start/reuse + first message
POST   /api/messages             { conversation_id, body }

GET    /api/admin/stats          (admin)
GET    /api/admin/users          (admin) ?q=
PUT    /api/admin/users/:id      (admin) { is_admin?, is_premium?, premium_until? }
DELETE /api/admin/users/:id      (admin)
DELETE /api/admin/listings/:id   (admin)
GET    /api/admin/settings       (admin)
PUT    /api/admin/settings       (admin) { mode: "open"|"premium-post"|"premium-browse"|"premium-all" }

GET    /health                   liveness probe
```

WebSocket: `ws://your.host/?token=<JWT>` — receives `{ type: "message", message, conversation_id }` events for incoming messages.
