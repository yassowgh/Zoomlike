# 🎥 Zoomlike

A Zoom-like video meeting app whose **primary feature is a real-time collaborative whiteboard** (freehand writing + shapes), with peer-to-peer video/audio, screen sharing, chat, and **session recording** that uploads to your own server. Runs entirely on **Cloudflare's free tier** — one deploy, no separate backend to run.

---

## What it does

- **Whiteboard (the main event)** — pen, line, rectangle, ellipse, arrow, text, eraser; colour + stroke width; per-user undo; clear-for-all. Drawings sync live to everyone and are **persisted per room**, so people who join late see the current board. Live cursors show where others are.
- **Video meeting** — camera + mic over WebRTC **peer-to-peer** (no media server = free). Mute, camera on/off, screen share.
- **Chat** — simple text chat alongside the board.
- **Recording** — records the whiteboard + everyone's audio to a `.webm` and **POSTs it to your own server** (or downloads locally if no server is configured).
- **Shareable rooms** — clean invite links (`/room/<name>`), no login, works on phones.

## Why this stack (all free)

| Concern | Choice | Free? |
|---|---|---|
| Hosting the app | **Cloudflare Workers Static Assets** | ✅ |
| Signaling + whiteboard sync + persistence | **Cloudflare Durable Object** (WebSocket, SQLite backend) | ✅ (free plan) |
| Video/audio transport | **WebRTC peer-to-peer mesh** + Google STUN | ✅ |
| CI/CD | **GitHub Actions** | ✅ |
| Recording storage | **Your own server** (or browser download) | your call |

> **Note on Firebase:** you mentioned Firebase, but it isn't needed here and would only add a second moving part. Cloudflare Durable Objects already give us real-time sync + persistence for free. If you later want accounts/login, Firebase Auth is a fine drop-in — the app currently uses room links with no login.

### Scaling note
A peer-to-peer **mesh** is perfect and free for small meetings (roughly **2–8 people**). For large rooms you'd switch the video transport to an SFU — **Cloudflare Realtime (Calls)** is the natural, mostly-free upgrade — while keeping the exact same whiteboard/signaling code. The room is capped at 12 connections by default (`MAX_PEERS` in `worker/room.js`).

---

## Project layout

```
wrangler.toml            Cloudflare config (assets + Durable Object binding)
worker/
  index.js               Worker: serves the app, routes /api/*
  room.js                Durable Object: signaling + whiteboard state per room
public/                  The web app (static, no build step)
  index.html
  css/styles.css
  js/
    main.js              Orchestrates everything
    signaling.js         WebSocket client to the room DO
    whiteboard.js        Canvas drawing engine (shared world coordinates)
    rtc.js               WebRTC mesh (perfect negotiation)
    recorder.js          MediaRecorder + upload to your server
.github/workflows/deploy.yml   Auto-deploy on push to main
```

---

## Deploy (two options)

### Option A — GitHub → Cloudflare (recommended, auto-deploys)
1. Push this repo to GitHub.
2. In the repo **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN` — create at Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** template.
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard → Workers & Pages (shown on the right).
3. Push to `main`. The Action runs `wrangler deploy` and your app goes live at
   `https://zoomlike.<your-subdomain>.workers.dev`.

### Option B — from your machine
```bash
npm install
npx wrangler login
npm run deploy
```

Local dev: `npm run dev` then open the printed URL. WebRTC needs HTTPS or `localhost`; `wrangler dev` serves on localhost so it works.

---

## Configuration

Set these as Worker variables (Cloudflare dashboard → your Worker → **Settings → Variables**), or in `wrangler.toml` `[vars]` for non-secret values:

| Variable | Purpose |
|---|---|
| `RECORDING_UPLOAD_URL` | Your server endpoint that receives recordings (see below). Leave empty to download locally instead. |
| `TURN_URLS` | Comma-separated TURN server URLs (optional; improves connectivity behind strict/corporate NATs). |
| `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN credentials (optional). |

STUN is built in and free. TURN is only needed if some users can't connect P2P; free STUN covers most home/mobile networks.

### Recording upload — your server's contract
When recording stops, the browser sends a **`multipart/form-data` POST** to `RECORDING_UPLOAD_URL` with:

- `file` — the recording (`video/webm`), filename `zoomlike-<room>-<timestamp>.webm`
- `room` — the room id
- `recordedAt` — ISO timestamp

Your server must return **2xx** and allow **CORS** from your app's origin. Minimal Node/Express example:

```js
import express from "express";
import multer from "multer";
const upload = multer({ dest: "recordings/" });
const app = express();

app.use((req, res, next) => {                 // CORS
  res.header("Access-Control-Allow-Origin", "https://zoomlike.<you>.workers.dev");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/upload", upload.single("file"), (req, res) => {
  console.log("saved", req.file.path, "room:", req.body.room);
  res.sendStatus(200);
});

app.listen(8080);
```

Then set `RECORDING_UPLOAD_URL=https://your-server.example/upload`.

---

## How the real-time bits work

- **Whiteboard coordinates** are stored in a fixed **1920×1080 "world"** and letterboxed to fit each screen, so everyone sees the same drawing regardless of device. Each shape has an id; the Durable Object stores shapes individually (`shape:<id>`) so late joiners load the current board and undo/erase are precise.
- **Signaling**: every participant opens one WebSocket to the room's Durable Object. Offers/answers/ICE candidates are relayed to specific peers; draw/erase/clear/cursor/chat are broadcast.
- **Media**: WebRTC uses **perfect negotiation** (`rtc.js`) so two peers offering at once don't clash. Screen share swaps the outgoing video track with `replaceTrack` (no renegotiation).

## Limitations / honest notes
- Mesh video is intended for small groups; use Cloudflare Realtime for large calls (see Scaling note).
- Accounts use email + password (Cloudflare-native, hashed). Invited people can join a room as a guest without registering.
- Cross-network video uses a free public TURN relay (Open Relay) by default; for heavy/production use set your own `TURN_*` (e.g. Cloudflare Realtime TURN).
- Recording captures the **whiteboard + audio** (not a grid of every camera). That's the most useful artifact for a whiteboard-first tool and keeps it lightweight; a full composite is a possible enhancement.
