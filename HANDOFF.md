# Zoomlike — Developer Handoff

A Zoom-like meeting app with a **collaborative whiteboard as the primary feature**, plus peer-to-peer video/audio, screen share, chat, recording, scheduling, waiting room, breakout rooms, host controls and virtual backgrounds. It runs **entirely on Cloudflare's free tier** with **no build step** (vanilla ES modules).

- **Live URL:** https://ancient-grass-94b8.yasser-ghallab-mm.workers.dev
- **Repo:** `yassowgh/Zoomlike` — default branch **`claude/cloudflare-zoom-app-o5xnvb`**, current work on **`claude/project-setup-ci-xeqtcc`**
- **Cloudflare account id:** `8831301adf4783f131f995656cbb8eec` · workers.dev subdomain `yasser-ghallab-mm` · Worker name `ancient-grass-94b8`

> This file is the single source of truth for continuing development. Read it fully before changing anything.

---

## 1. Tech stack (and why)

| Concern | Choice | Notes |
|---|---|---|
| Hosting + API | **Cloudflare Worker with Static Assets** | One deploy serves the SPA *and* the API. Free. |
| Realtime state / signaling / persistence | **Durable Objects (SQLite backend)** | Free plan. One DO per room + one global AUTH DO. |
| Video/audio transport | **WebRTC peer-to-peer mesh** | Free. Good for ~2–8 people. STUN + free public TURN. |
| Auth | **Custom, Cloudflare-native** | Email+password (PBKDF2) or Google OAuth, stateless HS256 JWT. No Firebase. |
| Frontend | **Vanilla JS ES modules + CSS** | No framework, no bundler, no build step. |
| CI/CD | **GitHub Actions** (`.github/workflows/deploy.yml`) | Deploys on push to `main`. `main` now exists; see §11 for the one remaining repo setting. |

**Runtime CDN libraries** (loaded lazily in the browser, not bundled):
- MediaPipe Selfie Segmentation — `cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation` (virtual backgrounds)
- jsPDF — `cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` (whiteboard → PDF)
- fix-webm-duration — `cdn.jsdelivr.net/npm/fix-webm-duration@1.0.5` (make recordings seekable)

There is **no CSP header** set by the Worker, so these CDNs load fine. If you add a CSP later, allowlist those hosts.

---

## 2. Repository layout

```
wrangler.toml            Cloudflare config: assets + 2 Durable Object bindings + migrations + vars
package.json             scripts: dev / deploy / tail / test:e2e (devDeps: wrangler, playwright)
.dev.vars.example        Documented template for .dev.vars (no secrets in it)
tests/                   Three end-to-end suites — see §9
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
    speaking.js          Active-speaker detection: one WebAudio analyser per stream, RMS + debounce.
    devices.js           Camera/mic/speaker enumeration, persistence, devicechange, pre-join level meter.
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
| `GOOGLE_CLIENT_ID` | var | Google OAuth web client id. Unset ⇒ the "Continue with Google" button is hidden. |
| `GOOGLE_CLIENT_SECRET` | **secret** | Google OAuth client secret. Both must be set for Google sign-in to appear. |
| `RESEND_API_KEY` + `MAIL_FROM` | **secret** + var | Sends password-reset email through Resend. |
| `MAIL_WEBHOOK_URL` | var | Alternative to Resend: any endpoint accepting `{to,name,subject,text,link}` as JSON. |

With no mail provider configured, the reset form says so plainly instead of
pretending a message was sent. See `.dev.vars.example` for the full template,
including the Google redirect URIs you must whitelist.

---

## 4. Architecture & data model

### Request routing (`worker/index.js`)
- `POST /api/auth/register` `{email,password,name}` → `{email,name,token}`
- `POST /api/auth/login` `{email,password}` → `{email,name,token}`
- `GET  /api/auth/me` (Bearer) → `{email,name,guest}`
- `POST /api/auth/guest` `{name}` → `{email:"",name,guest:true,token}` (invited users, no account)
- `GET  /api/auth/google/start?to=<path>` → 302 to Google. `to` is validated to be a path on this site, so it cannot be used as an open redirect.
- `GET  /api/auth/google/callback?code=&state=` → exchanges the code server-to-server, upserts the account by verified email, and redirects back with the session token **in the URL fragment** so it never lands in a server log.
- `POST /api/auth/forgot` `{email}` → `{ok:true, configured, delivered}`. Always the same shape, so it never reveals whether an address is registered.
- `POST /api/auth/reset` `{token,password}` → `{email,name,token}` (signs you straight in)
- `GET  /api/meetings` (Bearer, non-guest) → `{meetings:[…]}`
- `POST /api/meetings` `{title,when,room,access}` → meeting; also sets the room's owner = caller and its access mode (`"open"` | `"approval"`, default approval)
- `DELETE /api/meetings/:id` (Bearer)
- `GET  /api/config` → `{recordingUploadUrl, iceServers}`
- `GET  /api/room/:id/ws?name=&token=&skip=` → WebSocket upgrade. **JWT is verified here**; the trusted `name`/`email`/`guest` are taken from the token (query `name` is overwritten). Routes to the room's DO stub.
- everything else → `env.ASSETS` (SPA; `not_found_handling = single-page-application`).

### Durable Objects
- **`ROOMS`** — `idFromName(roomId)`, one instance per meeting. Hibernatable WebSockets.
- **`AUTH`** — `idFromName("global")`, single instance for all accounts + schedules.

### DO storage keys
`RoomDurableObject` — keys marked **(session)** are wiped when the host ends
the meeting; the rest describe the room and survive:
- `seq` (number) — monotonic join counter
- `owner` (string email) — the host identity
- `waiting` (bool, default true) — waiting room on/off; set from the access
  mode chosen when the meeting was created
- `allowDraw` (bool, default false) — everyone-can-draw **(session)**
- `allowShare` (bool, default false) — everyone-can-share **(session)**
- `boardOn` (bool, default true) — is the whiteboard enabled at all **(session)**
- `cohosts` (string[] of emails) — who the host promoted **(session)**
- `muteOnEntry` (bool) — mute people as they arrive **(session)**
- `startedAt` (ms) — meeting clock start **(session)**
- `breakoutEndsAt` (ms) — timed breakout deadline, backed by a DO alarm **(session)**
- `selfRoom` / `mainRoom` (string) — this room's own name, and the main room when this *is* a breakout
- `boardBg` (string, default `"dark"`) — shared board background **(session)**
- `spotlight` (connId or absent) — who the host has spotlighted **(session)**
- `breakouts` (string[]) — sub-room ids currently open **(session)**
- `shape:<id>` — one whiteboard object each (persisted board) **(session)**

Per-socket attachment also carries `grantShare` / `grantRecord`: permission the
host granted to *that person*, kept separate from the meeting-wide
`allowDraw`/`allowShare` toggles so revoking one does not strand the other.

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
| `hello` | `{access?}` | everyone (first msg; `access` is `"open"`/`"approval"` and only applies if this join is what creates the room) |
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
| `share-request` | — | admitted (asks the host to allow screen share) |
| `record-request` | — | admitted (asks the host to allow recording) |
| `share-decision` / `record-decision` | `{target, ok}` | host |
| `board-request` | — | admitted (asks the host to start the whiteboard) |
| `cohost` | `{target, on}` | **host only** |
| `rename` | `{name}` | everyone (renames yourself) |
| `mute-on-entry` | `{on}` | moderator |
| `breakout-move` | `{target, room, from?}` | moderator (`room:""` returns them to the main room) |
| `breakout-ask` | `{room}` | admitted (asks to switch rooms) |
| `breakout-announce` | `{text}` | moderator |
| `file-start` / `file-chunk` | see §6 | admitted |
| `board-decision` | `{target, ok}` | host |
| `recording` | `{on}` | admitted (announces a recording; consumes a non-host's permission on start) |
| `board-toggle` | `{on}` | host (whiteboard on/off for the meeting) |
| `board-bg` | `{bg}` | host (shared board background) |
| `spotlight` | `{target}` (null clears) | host |
| `end-session` | — | host (also resets the room, see §6) |
| `breakout-open` | `{rooms:[{room,name,members:[connId]}], minutes}` | moderator |
| `breakout-close` | — | host |

Server→client:

| type | payload |
|---|---|
| `welcome` | `{self, host, owner, peers:[{id,name}], board:[shape…], waiting, allowDraw, allowShare, boardOn, boardBg, spotlight, grantShare, grantRecord, canDraw, canShare, canRecord}` |
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
| `board-state` | `{on}` (whiteboard enabled/disabled) |
| `board-bg` | `{bg}` (shared board background) |
| `spotlight` | `{id}` (null clears) |
| `share-request` / `record-request` / `board-request` | `{id,name}` (to host) |
| `share-decision` / `record-decision` / `board-decision` | `{ok, by}` (to the requester) |
| `recording-state` | `{id,name,on}` (who is recording, to everyone) |
| `cohost` | `{on, by}` (your own role changed) |
| `peer-role` | `{id, moderator}` (someone else's role changed) |
| `renamed` | `{id, name}` |
| `mute-on-entry` | `{on}` |
| `breakout-state` | `{rooms:[{room,name}], endsAt}` |
| `breakout-ask` | `{id,name,room,from}` (to moderators) |
| `breakout-announce` | `{text, by}` |
| `file-start` / `file-chunk` / `file-error` | chat attachments |
| `session-end` | — |
| `breakout-open` | `{room, roomName}` |
| `breakout-close` | — |

Internal DO-to-DO (HTTP with `X-Internal` header): `broadcast` (relay a message to a sub-room's sockets, used by breakout-close), `set-owner` (`{email}`, used by scheduling).

---

## 6. Key domain logic

### Roles: host and co-hosts
The **host** is the meeting owner (below). The host may promote anyone to
**co-host**, and `isModerator = isHost || cohost` gates nearly everything.
Reserved to the host alone: **ending the meeting** and **managing co-hosts**.
Co-host is remembered by email (`cohosts` in storage), so it survives a
reconnect; a guest has no stable identity, so their co-host role lasts only for
that connection. Sub-rooms are handed the owner and the co-host list when a
breakout opens, so moderators are moderators in there too.

### Recovering a failed peer connection
`rtc.js` used to drop a peer the moment its connection reached `failed`, which
left that person in the roster with dead media until somebody reloaded. It now
rebuilds the connection (three attempts, reset on success) and re-offers —
re-adding the local tracks fires `onnegotiationneeded` by itself. The tile is
deliberately left in place while reconnecting rather than vanishing.

### Devices
`devices.js` enumerates hardware (labels only appear after permission is
granted, so it always runs post-getUserMedia), remembers choices in
`localStorage`, and listens for `devicechange`. Switching mid-meeting grabs a
new track and hands it to every peer via `replaceTrack`, so nobody is
disconnected. Speaker choice needs `setSinkId` and the field hides itself where
that is missing.

### Pre-join preview
Everyone passes through a camera/mic check on the way in, with two exceptions:
- **`skip=1`** — the meeting is moving you (into or out of a breakout). Being
  thrown into a room and asked "ready to join?" would be nonsense, and the
  devices were already chosen on the way into the meeting.
- **`localStorage.zl_skip_prejoin`** — the person ticked "Skip this check next
  time". Only honoured when a name is already remembered, so nobody is ever
  dropped into a meeting without having been asked who they are. The in-meeting
  Audio & video panel turns it back on.

### Breakout rooms
Members are navigated to `/room/<main>-b<n>?main=<main>&skip=1`. What the main
room's DO does when they open:
- gives each sub-room the meeting's `owner`, `cohosts`, `mainRoom` and access
  mode through the internal `set-owner` channel — **without this the first
  person into a breakout became its host**;
- with a time limit, stores `breakoutEndsAt` and sets a **Durable Object
  alarm**, so rooms close on time even if the moderator's browser is gone.

A moderator can move one person (`breakout-move`, which reaches them inside a
sub-room via the internal `relay-to` channel), join any room, return, and
announce to every room. A participant's `breakout-ask` travels sub-room →
main room over the internal `forward-request` channel and lands in the
moderators' request queue.

### Chat attachments
Sliced into 64 KB pieces client-side and relayed as `file-chunk` messages,
because Durable Object WebSocket frames top out near 1 MiB. 10 MB cap. Files
are **relayed, never stored**, so a late joiner does not receive one.

### Host = the meeting OWNER (not first to enter)
- `owner` is the first **non-guest** email to join a room, persisted; or preset by scheduling (`set-owner`).
- The **host** is the connected admitted socket whose `email === owner`. Recomputed on join/leave and re-broadcast via `host`. If the owner isn't present, there is no host (participants wait — "waiting for host").
- Host actions are enforced server-side (`isHost` check in `room.js`).

### Ending a meeting resets the room
`end-session` broadcasts `session-end`, wipes every **(session)** storage key
listed above (whiteboard included), and closes all sockets. `owner` and
`waiting` survive, so the same person still hosts the room and it still opens
the same way next time. Clients tear down locally and stop reconnecting.

### Access mode
Chosen when the meeting is created — "anyone with the link" or "I approve each
person" — and stored as `waiting`. Scheduling sets it through the internal
`set-owner` call; an ad-hoc room takes it from the `access` field on the
creating user's `hello`. It is still changeable mid-meeting with the host's
waiting-room toggle.

### Joining from an invite link
Opening `/room/<id>` never shows the login form. A remembered display name
(`localStorage.zl_name`) joins silently; otherwise a name-only card asks once,
takes a guest token, and joins. Signing in is an opt-in link on that card.

### View layouts (per viewer)
`state.layout` is `board` | `speaker` | `gallery` and `state.strip` is
`right` | `bottom` | `hidden`; both persist in `localStorage`. `applyLayout()`
computes an *effective* layout — a shared screen wins, then an active
spotlight, then a disabled whiteboard falls back to speaker — without ever
rewriting the viewer's stored preference, so it returns when the override
lifts.

### Accounts: password, Google, or both
Accounts are keyed by **email address**, so signing in with Google to an address
that already has a password links the two rather than creating a second account.
A Google-only account has no `salt`/`hash`; logging into one with a password
returns a message pointing at the Google button. Such a user can add a password
by going through the reset flow.

Google uses the OAuth 2.0 **authorization-code** flow. The `id_token` is fetched
server-to-server from Google over TLS using the client secret, so its claims are
trusted without a separate signature check; `email_verified: false` is rejected.
The `state` parameter is a short-lived HS256 blob signed with `AUTH_SECRET`, so
the callback needs no server-side session.

### Password reset
`forgot-create` stores only `sha256(token)` under `reset:<hash>` with a 30-minute
expiry, so storage alone cannot be used to reset anyone's password. The token is
deleted the moment it is presented — before validity is even checked — so a link
can never be replayed. The endpoint answers identically for unknown addresses
and sends nothing for them.

### Active speaker
`speaking.js` runs one WebAudio analyser per stream, sampled every 120 ms, and
calls the loudest participant above a noise floor the active speaker. Two rules
keep it steady: a challenger has to hold the lead for 250 ms before it switches,
and the current speaker is kept for at least 1.4 s. **Silence is treated as no
information at all** rather than a candidate change — speech is full of gaps, and
resetting the timer on each one meant nobody ever won. It also keeps the last
speaker highlighted through their own pauses.

### Permission model
Three independent sources, recombined by `recomputePerms()`:
1. being the host,
2. the meeting-wide `allowDraw` / `allowShare` toggles,
3. a personal `grantShare` / `grantRecord` from the host, held per socket.

Pressing Share or Record without permission sends `share-request` /
`record-request` to the host, who allows or denies it from the participants
panel. Turning the whiteboard *on* works the same way (`board-request`) — only
the host can switch it off.

Recording permission is **consumed when a recording starts**, so every separate
recording needs the host to approve it again, and everyone in the room sees a
red marker naming whoever is recording.

Screen share is enforced server-side. **Recording is not, and cannot be** — a
determined participant can always run a screen recorder on their own machine.
Treat the recording gate as a policy control, the same as Zoom's.

### Spotlight
The host spotlights someone from the participants panel; every client switches
to the speaker stage and shows that person until it is cleared. It is cleared
automatically if the spotlighted person leaves.

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

Auth/registration · **one-tap join from an invite link (no account)** · lobby ·
**meeting access mode (open / host approves)** · **whiteboard** (pen, line, rect, ellipse, arrow, inline text, eraser, images, select/move/resize/lock/delete, undo, clear, zoom, pan, backgrounds, PNG/PDF export) · live cursors · **WebRTC** camera/mic · **screen share as a main stage (camera continues)** · gallery grid view · chat (public + private) · reactions · raise/lower hand · **participants panel** · **host controls** (mute all, mute one, remove, lower all hands) · **waiting room + admit/deny** · **host = meeting creator** · **draw & share permissions** (host toggles) · **end meeting for all** · **breakout rooms** · **scheduled meetings** · **virtual camera backgrounds** · **session recording** (seekable, save locally or to your server) · **whiteboard on/off for the meeting** · **shared board background set by the host** · **spotlight** · **switchable layouts (whiteboard / speaker / gallery, strip side / bottom / hidden)** · **share & record permission requests** · **room reset when the meeting ends** · **phone-first control bar** · **co-hosts** · **camera/mic/speaker picker (switchable mid-meeting)** · **pre-join preview** · **timed breakout rooms with moves, switch requests, moderator visits and announcements** · **mute on entry** · **rename yourself** · **meeting timer** · **file sharing in chat**.

---

## 8. Known limitations & gotchas

- **Mesh scaling:** fine for ~2–8; hard cap `MAX_PEERS=20` in `room.js`. For big meetings switch video transport to an SFU (**Cloudflare Realtime/Calls**) — the whiteboard/signaling code stays.
- **Screen-share routing** identifies the screen stream by id announced over WS; there can be timing edge cases across flaky networks. The camera-continues guarantee holds regardless.
- **Virtual backgrounds** need MediaPipe to load from CDN and are CPU-heavy; they degrade gracefully (toast + keep plain camera) if the model fails.
- **Breakout rooms** work by navigating participants to sub-rooms (`/room/<main>-b<n>?main=<main>&skip=1`); `skip=1` bypasses the waiting room; token persists via `sessionStorage`. "Close all" reaches sub-rooms via the DO-to-DO `broadcast` channel.
- **Images** are stored as data URLs in DO storage (SQLite value limit ~2 MiB) and broadcast over WS — keep them downscaled; the persist is wrapped in try/catch so a too-large image still shows live but may not persist for late joiners.
- **Whiteboard move/resize** sync the **final** state on pointer-up (no live intermediate frames).
- **Draw/share permission** is a global host toggle — there is no per-user request/approve flow yet.
- **No TURN relay is configured by default,** and the built-in fallback (a free public Open Relay) is no longer dependable. Anyone behind a strict NAT — most mobile networks — will appear in the participant list with no video, or take minutes to connect. Set `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL`; Cloudflare Realtime TURN has a free tier. The UI now shows per-participant connection state and warns once when a connection fails with no relay configured.
- **Recording permission is advisory.** The host's approval gates the app's own recorder; nothing can stop someone screen-recording their device. Same as Zoom.
- **Recording on a phone cannot use a save dialog** — no mobile browser has one. Android lands in Downloads; iOS ignores the download attribute on a blob URL and opens the file instead, so the user is told to save it from the share sheet. Setting `RECORDING_UPLOAD_URL` is the reliable path on mobile.
- **iOS records MP4, everyone else WebM.** Safari has never supported WebM recording. The extension follows the real container, and the WebM duration patch is skipped for MP4 — which means **MP4 recordings are not seekable** until something remuxes them.
- **Google sign-in and password reset are both opt-in** and stay hidden/disabled until their environment variables are set (see §3).
- **Chat attachments are relayed, not stored.** Someone who joins after a file was shared will not see it, and there is a 10 MB cap. Persisting them would need R2.
- **A guest's co-host role does not survive their reconnect** — it is remembered by email, and a guest has none.
- **The pre-join preview adds one click** for a returning guest following an invite link, unless they tick "Skip this check next time" (see §6), which restores the zero-click path. Being moved into a breakout always bypasses it.
- **Breakout membership is decided when the rooms open.** Someone who joins the meeting afterwards is not assigned to a room until a moderator moves them.
- Speaker (audio output) selection is Chromium-only; the field hides itself elsewhere.
- **Board background is host-only** now that it is shared state; participants can no longer set their own.
- A **phone always uses the bottom strip**, whichever strip position the viewer picked — a side strip does not fit.
- The e2e test in §9 needs a **local** `wrangler dev`; there is no unit test for the DO logic yet. No rate limiting. Old rooms' DO storage is never garbage-collected.
- Recording of the **shared screen** is not included in the composite.

---

## 9. Testing

Six committed suites, 137 checks in total, run with `npm test` against a
**local** `wrangler dev`:

| Suite | Script | Covers |
|---|---|---|
| `tests/e2e.mjs` | `npm run test:e2e` | the meeting flow (38) |
| `tests/e2e-controls.mjs` | `npm run test:controls` | active speaker, whiteboard requests, per-recording approval (16) |
| `tests/e2e-meeting.mjs` | `npm run test:meeting` | co-hosts, devices, pre-join, breakouts, mute-on-entry, rename, timer, chat files (28) |
| `tests/e2e-mobile.mjs` | `npm run test:mobile` | every screen and panel at 390px and 320px: overflow, tap targets, covered controls, skippable pre-join (20) |
| `tests/e2e-fixes.mjs` | `npm run test:fixes` | regressions from a real call: text size and resize, guest names, participant names, chat vs gallery, landscape phones (11) |
| `tests/e2e-auth.mjs` | `npm run test:auth` | Google sign-in redirect + password reset (23) |

`tests/e2e-auth.mjs` starts its own mailbox on port 8799 to catch the reset
link, so `.dev.vars` needs `MAIL_WEBHOOK_URL=http://127.0.0.1:8799/mail` plus
any `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` values (dummies are fine — the
redirect to Google is checked, not completed). Without them that suite skips
itself rather than failing.

The main suite drives two desktop browser contexts plus a phone viewport and
asserts on the real UI and on live app state (`window.__zl_state`, exposed by
`main.js` for exactly this purpose). 38 checks covering: register/login, the
invite-link quick join, access modes, waiting room admit, P2P media actually
flowing, whiteboard sync, board on/off, shared background, layouts and their
persistence, spotlight (including that clearing it restores each viewer's own
layout), share/record permission requests, host mute/mute-all/remove, the phone
control-bar collapse, and the room reset after the meeting ends.

```bash
npx wrangler dev --port 8787 --local   # in one shell
npm test                               # in another
```
It exits non-zero if anything fails and drops screenshots in
`tests/screenshots/` (gitignored). Env overrides: `ZL_BASE`, `ZL_CHROMIUM`,
`ZL_SHOTS`.

Notes on the environment:
```bash
npx wrangler dev --port 8787 --local   # in one shell
# Playwright (chromium is preinstalled in the CC-web sandbox):
#   executablePath: /opt/pw-browsers/chromium
#   args: --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --no-sandbox
#   grant context permissions: ["camera","microphone"]
```
Test against `http://127.0.0.1:8787` (the sandbox's egress proxy makes hitting the live workers.dev from headless Chromium unreliable; local Miniflare is the reliable target). Fake media lets two contexts establish real P2P locally. Things that can't be exercised headlessly: `getDisplayMedia` (screen share), MediaPipe/jsPDF/fix-webm CDN loads, the native Save dialog — verify those in a real browser. The share **request/approve** flow is covered; the actual capture that follows is not.

Still worth adding: `vitest` + `@cloudflare/vitest-pool-workers` for the DO logic directly (host election, admit, permission gating, session reset).

---

## 10. Suggested next steps

1. Per-user **draw** request → approve. Share, record and whiteboard-start now work this way (§6); drawing is still only the global toggle, and should follow the same pattern.
2. Make MP4 recordings seekable (remux, or record in fragments), so iOS output scrubs like the WebM output does.
3. Include the **shared screen** in recordings; optionally record locally per-user or via an SFU egress.
4. **Reconnection resync**: on WS reconnect, re-request the roster/board (currently relies on the reconnect + welcome).
5. Persist chat attachments in R2 so late joiners can still download them.
6. **Mobile/RTL polish** (this is Yasser's standing requirement: ≥44px targets, 360px width, Arabic `dir="rtl"` where relevant).
6. Move to **Cloudflare Realtime (SFU)** for large rooms; add **Cloudflare Realtime TURN** for guaranteed connectivity.
7. Wire `npm run test:e2e` into the GitHub Action before deploy (the test exists now; CI does not run it).
8. Garbage-collect stale room DOs (e.g., clear `shape:*` when a room has been empty for N days).

---

## 11. Environment notes for the next Claude/dev

- This repo is developed via **Claude Code on the web** (ephemeral container, repo cloned fresh). Commit + push anything worth keeping.
- **`main` now exists**, branched from the old default at `29b2765`, and
  `deploy.yml` deploys on push to it. One thing is still outstanding and can
  only be done in the GitHub UI: **set `main` as the repository's default
  branch** (Settings → General → Default branch). Until then new pull requests
  still target `claude/cloudflare-zoom-app-o5xnvb`.
- Deploys need repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
  without them the workflow runs and fails at the deploy step.
- **Cloudflare's API is blocked from cloud sessions**, so `wrangler deploy`,
  `wrangler secret put` and `wrangler tail` all fail from here. Deploys go
  through GitHub Actions or a local machine. `wrangler dev --local` is
  unaffected, and is what the e2e test targets.
- Deploying needs the user's Cloudflare API token (an "Edit Cloudflare Workers" token, pasted in and deleted afterward). Never commit tokens. `AUTH_SECRET` is a Cloudflare secret, not in git.
- `playwright` is a declared devDependency. It used to be in the lockfile but
  undeclared, so every `npm install` pruned it; don't undo that.
- No build step: edit files, `wrangler dev` to test, `wrangler deploy` to ship. After deploying, hard-refresh the site (assets are cached).
- **Keep commit messages free of any model/assistant identifiers** per repo
  convention — no `Co-Authored-By` or session trailers. (Commits before
  `29b2765` predate this and still carry them.)
