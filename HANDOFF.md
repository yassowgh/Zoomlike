# Zoomlike — Developer Handoff

A Zoom-like meeting app with a **collaborative whiteboard as the primary feature**, plus peer-to-peer video/audio, screen share, chat, recording, scheduling, waiting room, breakout rooms, host controls and virtual backgrounds. It runs **entirely on Cloudflare's free tier** with **no build step** (vanilla ES modules).

- **Live URL:** https://ancient-grass-94b8.yasser-ghallab-mm.workers.dev
- **Repo:** `yassowgh/Zoomlike` — active branch **`claude/cloudflare-zoom-app-o5xnvb`**
- **Cloudflare account id:** `8831301adf4783f131f995656cbb8eec` · workers.dev subdomain `yasser-ghallab-mm` · Worker name `ancient-grass-94b8`

> This file is the single source of truth for continuing development. Read it fully before changing anything.

---

## 1. Tech stack (and why)

| Concern | Choice | Notes |
|---|---|---|
| Hosting + API | **Cloudflare Worker with Static Assets** | One deploy serves the SPA *and* the API. Free. |
| Realtime state / signaling / persistence | **Durable Objects (SQLite backend)** | Free plan. One DO per room + one global AUTH DO. |
| Video/audio transport | **WebRTC peer-to-peer mesh** | Free. Good for ~2–8 people. STUN + free public TURN. |
| Auth | **Custom, Cloudflare-native** | Email+password (PBKDF2), stateless HS256 JWT. No Firebase. |
| Frontend | **Vanilla JS ES modules + CSS** | No framework, no bundler, no build step. |
| CI/CD | **GitHub Actions** (`.github/workflows/deploy.yml`) | Deploys on push to `main`. |

**Runtime CDN libraries** (loaded lazily in the browser, not bundled):
- MediaPipe Selfie Segmentation — `cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation` (virtual backgrounds)
- jsPDF — `cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` (whiteboard → PDF)
- fix-webm-duration — `cdn.jsdelivr.net/npm/fix-webm-duration@1.0.5` (make recordings seekable)

There is **no CSP header** set by the Worker, so these CDNs load fine. If you add a CSP later, allowlist those hosts.

---

## 2. Repository layout

```
wrangler.toml            Cloudflare config: assets + 2 Durable Object bindings + migrations + vars
package.json             scripts: dev / deploy / tail (only devDep: wrangler)
.github/workflows/deploy.yml   GitHub Actions → wrangler deploy on push to main
.dev.vars                LOCAL secrets for `wrangler dev` (gitignored) — contains AUTH_SECRET for dev

worker/
  index.js               Worker entry: routing for /api/auth/*, /api/meetings, /api/config,
                         /api/room/:id/ws (verifies JWT), else static assets. buildIceServers().
  room.js                RoomDurableObject — per room: signaling relay, whiteboard broadcast+persist,
                         host/owner logic, waiting room, mute, hands, reactions, chat routing,
                         permissions, breakout relay, end-session. Internal DO-to-DO channel.
  auth.js                AuthDurableObject — accounts (PBKDF2) + scheduled meetings storage.
                         Also exports issueToken()/readToken() (HS256 JWT) used by index.js.

public/
  index.html             All screens: #auth, #lobby, #room (topbar, whiteboard, videos, controls,
                         side panels, modals). Single page; screens toggled with the [hidden] attribute.
  css/styles.css         All styles. Dark theme via CSS variables at :root.
  js/
    main.js              Orchestrator (~1100 lines): auth flow, lobby, join, media, wiring of every
                         control, signaling event handlers, roster, screen routing, scheduling,
                         permissions UI, export, virtual bg glue.
    signaling.js         WebSocket client to the room DO (auto-reconnect, EventTarget of message types).
    rtc.js               Mesh — one RTCPeerConnection per peer, perfect negotiation, camera track +
                         optional additional screen track, replaceVideoTrack for camera/virtual-bg.
    whiteboard.js        Object-model canvas: pen/line/rect/ellipse/arrow/text/image, select/move/
                         resize/lock/delete, pan/zoom viewport, inline text editing, PNG/PDF export source.
    recorder.js          Compositing recorder (opaque canvas: whiteboard + video strip + mixed audio),
                         WebM duration fix, save to computer (File System Access API) or upload to server.
    virtualbg.js         MediaPipe selfie-segmentation processor → blur / generated scene backgrounds.
```

---

## 3. Run locally, and deploy

### Local dev (fully offline via Miniflare; Durable Objects work locally)
```bash
npm install
npx wrangler dev --port 8787 --local
# open http://127.0.0.1:8787
```
`.dev.vars` supplies `AUTH_SECRET` for local runs. WebRTC needs a secure context; `localhost` counts, so P2P works locally between two tabs.

### Deploy
```bash
npm install
# one-time: set the production JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | \
  CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=8831301adf4783f131f995656cbb8eec \
  npx wrangler secret put AUTH_SECRET
# deploy
CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=8831301adf4783f131f995656cbb8eec npx wrangler deploy
```
- The API token must be a Cloudflare **"Edit Cloudflare Workers"** template token **scoped to include this account** (a token that can't list the account still fails; pass `CLOUDFLARE_ACCOUNT_ID`).
- GitHub Actions path: set repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then push to `main`.

### Environment variables / secrets
| Name | Where | Purpose |
|---|---|---|
| `AUTH_SECRET` | **secret** (`wrangler secret put`) | Signs login JWTs. Falls back to `"dev-secret-change-me"` if unset (don't ship that). |
| `RECORDING_UPLOAD_URL` | var | If set, recordings POST here (multipart `file`,`room`,`recordedAt`) with CORS from the app origin. Empty = save to computer. |
| `TURN_URLS`,`TURN_USERNAME`,`TURN_CREDENTIAL` | vars | Optional custom TURN. If unset, a free public Open Relay TURN is used by default. |

---

## 4. Architecture & data model

### Request routing (`worker/index.js`)
- `POST /api/auth/register` `{email,password,name}` → `{email,name,token}`
- `POST /api/auth/login` `{email,password}` → `{email,name,token}`
- `GET  /api/auth/me` (Bearer) → `{email,name,guest}`
- `POST /api/auth/guest` `{name}` → `{email:"",name,guest:true,token}` (invited users, no account)
- `GET  /api/meetings` (Bearer, non-guest) → `{meetings:[…]}`
- `POST /api/meetings` `{title,when,room}` → meeting; also sets the room's owner = caller
- `DELETE /api/meetings/:id` (Bearer)
- `GET  /api/config` → `{recordingUploadUrl, iceServers}`
- `GET  /api/room/:id/ws?name=&token=&skip=` → WebSocket upgrade. **JWT is verified here**; the trusted `name`/`email`/`guest` are taken from the token (query `name` is overwritten). Routes to the room's DO stub.
- everything else → `env.ASSETS` (SPA; `not_found_handling = single-page-application`).

### Durable Objects
- **`ROOMS`** — `idFromName(roomId)`, one instance per meeting. Hibernatable WebSockets.
- **`AUTH`** — `idFromName("global")`, single instance for all accounts + schedules.

### DO storage keys
`RoomDurableObject`:
- `seq` (number) — monotonic join counter
- `owner` (string email) — the host identity
- `waiting` (bool, default true) — waiting room on/off
- `allowDraw` (bool, default false) — everyone-can-draw
- `allowShare` (bool, default false) — everyone-can-share
- `breakouts` (string[]) — sub-room ids currently open
- `shape:<id>` — one whiteboard object each (persisted board)

`AuthDurableObject`:
- `user:<email>` → `{email,name,salt,hash,createdAt}` (PBKDF2 SHA-256, 100k iters, 16-byte salt, hex)
- `sched:<email>:<id>` → `{id,title,when,room,ownerEmail,ownerName,createdAt}`

### WebSocket connection metadata (per socket `serializeAttachment`)
`{connId, name, email, guest, skip, seq, admitted}`

---

## 5. WebSocket message protocol

Client→server (`room.js` `webSocketMessage`). Non-`hello` messages are ignored unless the socket is `admitted`. `draw`/`erase`/`clear` also require draw permission (host or `allowDraw`). Host-only messages are ignored from non-hosts.

| type | payload | who |
|---|---|---|
| `hello` | — | everyone (first msg) |
| `signal` | `{to, data}` | admitted (WebRTC SDP/ICE relay) |
| `screen` | `{on, streamId}` | admitted (announce screen share stream id) |
| `draw` | `{shape}` | draw-permitted (add or update an object; persisted) |
| `erase` | `{id}` | draw-permitted |
| `clear` | — | draw-permitted |
| `cursor` | `{x,y}` | admitted (world coords) |
| `chat` | `{text, to?}` | admitted (`to`=connId ⇒ private) |
| `media` | `{mic,cam}` | admitted (roster state) |
| `hand` | `{up}` | admitted |
| `react` | `{emoji}` | admitted |
| `host-mute` | `{target:'all'|connId}` | host |
| `hand-lower-all` | — | host |
| `host-remove` | `{target}` | host |
| `admit` / `deny` | `{id}` | host (waiting room) |
| `waiting-toggle` | `{on}` | host |
| `allow-draw` / `allow-share` | `{on}` | host |
| `end-session` | — | host |
| `breakout-open` | `{rooms:[{room,name,members:[connId]}]}` | host |
| `breakout-close` | — | host |

Server→client:

| type | payload |
|---|---|
| `welcome` | `{self, host, owner, peers:[{id,name}], board:[shape…], waiting, allowDraw, allowShare, canDraw, canShare}` |
| `waiting` | — (you're in the waiting room) |
| `wait-request` | `{id,name}` (to host) |
| `denied` | — |
| `peer-join` / `peer-leave` | `{id,name?}` |
| `host` | `{id}` (host reassigned) |
| `signal` | `{from,name,data}` |
| `screen` | `{id,name,on,streamId}` |
| `draw` / `erase` / `clear` | `{shape}` / `{id}` / — |
| `cursor` | `{id,name,x,y}` |
| `chat` | `{id,name,text,to}` |
| `media` | `{id,mic,cam}` |
| `hand` | `{id,name,up}` |
| `react` | `{id,name,emoji}` |
| `force-mute` | `{by}` |
| `removed` | `{by}` |
| `waiting-state` | `{on}` |
| `perm` | `{what:'draw'|'share', on}` |
| `session-end` | — |
| `breakout-open` | `{room, roomName}` |
| `breakout-close` | — |

Internal DO-to-DO (HTTP with `X-Internal` header): `broadcast` (relay a message to a sub-room's sockets, used by breakout-close), `set-owner` (`{email}`, used by scheduling).

---

## 6. Key domain logic

### Host = the meeting OWNER (not first to enter)
- `owner` is the first **non-guest** email to join a room, persisted; or preset by scheduling (`set-owner`).
- The **host** is the connected admitted socket whose `email === owner`. Recomputed on join/leave and re-broadcast via `host`. If the owner isn't present, there is no host (participants wait — "waiting for host").
- Host actions are enforced server-side (`isHost` check in `room.js`).

### Auth / sessions
- JWT HS256, payload `{email,name,exp,guest?}`, 7-day expiry, signed with `AUTH_SECRET`.
- Token stored in `localStorage` (registered, persistent) **and** `sessionStorage` (everyone, so a reload/breakout-navigation re-joins — guests included).
- Guests get a name-only token from `/api/auth/guest`; they can't schedule and can't be owner.

### Whiteboard object model (`whiteboard.js`)
World coordinates; each viewer has a personal viewport `{scale, panX, panY}` (pan/zoom is per-viewer). Objects:
- `pen`   `{id,type,color,size,points:[{x,y}],locked?}`
- `line`/`arrow`/`rect`/`ellipse` `{id,type,color,size,x1,y1,x2,y2,locked?}`
- `text`  `{id,type,x,y,text,size,color,w?,h?,locked?}` (inline `<textarea>` editing; double-click to edit)
- `image` `{id,type,x,y,w,h,src(dataURL),locked?}` (insert via button/paste; downscaled to ≤1000px JPEG)
- Local-only flag `mine:true` is stripped before sending. Add **and** update both send `draw` (server `put` overwrites). Delete sends `erase`.
- Export: `exportImage(bg)` flattens all objects to a PNG data URL (used for PNG download and as the jsPDF image).

### WebRTC mesh (`rtc.js`)
- Perfect negotiation (polite/impolite by `selfId < peerId`).
- Camera/virtual-bg use `replaceVideoTrack` on the single camera sender.
- **Screen share is an ADDITIONAL track** (`setScreenStream`/`stopScreenStream`) so the camera keeps running. The sharer announces the screen stream id via the `screen` message; receivers route the matching incoming stream to the main stage (`routeStream` in main.js), cameras stay in the strip.
- ICE: Google STUN + free public Open Relay TURN by default (override via `TURN_*`).

### Recording (`recorder.js`)
- Composites onto an **opaque** 1280×720 canvas (whiteboard scaled on top + participant video strip along the bottom) with a steady rAF loop + mixed audio → valid, playable WebM (fixes the earlier black/corrupt output).
- Injects WebM **duration** with fix-webm-duration so the file is **seekable**.
- Saves via the File System Access "Save As" dialog where supported (else Downloads), or POSTs to `RECORDING_UPLOAD_URL`.
- Note: it records whiteboard + cameras, **not** the shared screen (possible enhancement).

---

## 7. Feature inventory (all implemented & deployed)

Auth/registration · guest join via invite link · lobby · **whiteboard** (pen, line, rect, ellipse, arrow, inline text, eraser, images, select/move/resize/lock/delete, undo, clear, zoom, pan, backgrounds, PNG/PDF export) · live cursors · **WebRTC** camera/mic · **screen share as a main stage (camera continues)** · gallery grid view · chat (public + private) · reactions · raise/lower hand · **participants panel** · **host controls** (mute all, mute one, remove, lower all hands) · **waiting room + admit/deny** · **host = meeting creator** · **draw & share permissions** (host toggles) · **end meeting for all** · **breakout rooms** · **scheduled meetings** · **virtual camera backgrounds** · **session recording** (seekable, save locally or to your server).

---

## 8. Known limitations & gotchas

- **Mesh scaling:** fine for ~2–8; hard cap `MAX_PEERS=20` in `room.js`. For big meetings switch video transport to an SFU (**Cloudflare Realtime/Calls**) — the whiteboard/signaling code stays.
- **Screen-share routing** identifies the screen stream by id announced over WS; there can be timing edge cases across flaky networks. The camera-continues guarantee holds regardless.
- **Virtual backgrounds** need MediaPipe to load from CDN and are CPU-heavy; they degrade gracefully (toast + keep plain camera) if the model fails.
- **Breakout rooms** work by navigating participants to sub-rooms (`/room/<main>-b<n>?main=<main>&skip=1`); `skip=1` bypasses the waiting room; token persists via `sessionStorage`. "Close all" reaches sub-rooms via the DO-to-DO `broadcast` channel.
- **Images** are stored as data URLs in DO storage (SQLite value limit ~2 MiB) and broadcast over WS — keep them downscaled; the persist is wrapped in try/catch so a too-large image still shows live but may not persist for late joiners.
- **Whiteboard move/resize** sync the **final** state on pointer-up (no live intermediate frames).
- **Draw/share permission** is a global host toggle — there is no per-user request/approve flow yet.
- **No automated tests** live in the repo (see §9). No rate limiting. Old rooms' DO storage is never garbage-collected.
- Recording of the **shared screen** is not included in the composite.

---

## 9. How this was tested (no test suite in repo)

Testing was done ad-hoc with Playwright against a **local** `wrangler dev`:
```bash
npx wrangler dev --port 8787 --local   # in one shell
# Playwright (chromium is preinstalled in the CC-web sandbox):
#   executablePath: /opt/pw-browsers/chromium
#   args: --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --no-sandbox
#   grant context permissions: ["camera","microphone"]
```
Test against `http://127.0.0.1:8787` (the sandbox's egress proxy makes hitting the live workers.dev from headless Chromium unreliable; local Miniflare is the reliable target). Fake media lets two contexts establish real P2P locally. Things that can't be exercised headlessly: `getDisplayMedia` (screen share), MediaPipe/jsPDF/fix-webm CDN loads, the native Save dialog — verify those in a real browser.

Consider adding a real suite: `@playwright/test` for the flows above, plus `vitest` + `@cloudflare/vitest-pool-workers` for the DO logic (host election, waiting-room admit, permission gating).

---

## 10. Suggested next steps

1. Per-user draw/share **request → approve** (not just a global toggle) — reuse the waiting-room request/relay pattern.
2. **Active-speaker** detection (WebAudio analyser per stream) → highlight tile / auto-promote in gallery.
3. Include the **shared screen** in recordings; optionally record locally per-user or via an SFU egress.
4. **Reconnection resync**: on WS reconnect, re-request the roster/board (currently relies on the reconnect + welcome).
5. **Mobile/RTL polish** (this is Yasser's standing requirement: ≥44px targets, 360px width, Arabic `dir="rtl"` where relevant).
6. Move to **Cloudflare Realtime (SFU)** for large rooms; add **Cloudflare Realtime TURN** for guaranteed connectivity.
7. Commit an automated test suite and wire it into the GitHub Action before deploy.
8. Garbage-collect stale room DOs (e.g., clear `shape:*` when a room has been empty for N days).

---

## 11. Environment notes for the next Claude/dev

- This repo is developed via **Claude Code on the web** (ephemeral container, repo cloned fresh). Commit + push anything worth keeping. Designated branch: `claude/cloudflare-zoom-app-o5xnvb`.
- Deploying needs the user's Cloudflare API token in-session (they create an "Edit Cloudflare Workers" token, paste it, and delete it afterward). Never commit tokens. `AUTH_SECRET` is a Cloudflare secret, not in git.
- No build step: edit files, `wrangler dev` to test, `wrangler deploy` to ship. After deploying, hard-refresh the site (assets are cached).
- Keep commit messages free of any model/assistant identifiers per repo convention.
