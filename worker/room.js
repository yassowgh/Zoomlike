// RoomDurableObject: one instance per meeting room.
//
//   1. WebRTC signaling relay (mesh) + whiteboard broadcast/persistence.
//   2. Meeting control: OWNER-based host, waiting room + admit, mute,
//      raise/lower hands, reactions, media state, public/private chat.
//   3. Shared meeting surface state: whiteboard on/off, board background,
//      spotlight — all host-controlled and mirrored to everyone.
//   4. Per-user requests: share screen / record / whiteboard need the host's
//      approval unless the host has opened them up for everyone.
//   5. Breakout rooms: timed sub-rooms, moving people between them, change
//      requests relayed back to the main room, and announcements.
//
// MODERATORS. The host may promote others to co-host. A co-host can do
// everything a host can except end the meeting and manage co-hosts, so most
// checks below use `isModerator` and only a few use `isHost`.
//
// The host is the meeting OWNER (the account that created/scheduled it), not
// whoever joined first. The owner is remembered, so the host is stable across
// reconnects and returns.

const MAX_PEERS = 20;

// Room state belonging to a single SESSION, wiped when the host ends the
// meeting. Everything else ("owner", "waiting", "seq") describes the room
// itself and deliberately survives.
const SESSION_KEYS = [
  "breakouts", "allowDraw", "allowShare", "spotlight", "boardOn", "boardBg",
  "cohosts", "muteOnEntry", "startedAt", "breakoutEndsAt", "started",
];

// A chat attachment is relayed in slices: Durable Object WebSocket messages
// top out around 1 MiB, and a slice has to fit with room to spare.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const DEFAULT_BG = "white";

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // --- internal DO-to-DO control channel (breakouts, scheduling) --------
    const internal = request.headers.get("X-Internal");
    if (internal === "broadcast") {
      const msg = await request.json().catch(() => null);
      if (msg) this.broadcast(msg);
      return new Response("ok");
    }
    if (internal === "set-owner") {
      const { email, access, cohosts, mainRoom, endsAt, started } = await request.json().catch(() => ({}));
      // A one-link call is open from the moment the link is made.
      if (started) await this.state.storage.put("started", true);
      if (email) await this.state.storage.put("owner", email);
      // "open"  -> anyone with the link walks straight in.
      // "approval" -> the host admits each person from the waiting room.
      if (access === "open" || access === "approval") {
        await this.state.storage.put("waiting", access === "approval");
      }
      // Used when a breakout room is created, so the meeting's moderators are
      // moderators inside it too rather than whoever walks in first.
      // A breakout room exists because a moderator opened it, so it counts as
      // started even before anyone walks in.
      if (Array.isArray(cohosts)) { await this.state.storage.put("cohosts", cohosts); await this.state.storage.put("started", true); }
      if (mainRoom) await this.state.storage.put("mainRoom", mainRoom);
      if (endsAt) await this.state.storage.put("breakoutEndsAt", endsAt);
      return new Response("ok");
    }
    // Main room -> sub-room: deliver a message to one participant in there.
    if (internal === "relay-to") {
      const { id, msg } = await request.json().catch(() => ({}));
      if (id && msg) this.toId(id, msg);
      return new Response("ok");
    }
    // Sub-room -> main room: someone in a breakout wants something from the
    // moderators, who are back in the main room.
    if (internal === "forward-request") {
      const msg = await request.json().catch(() => null);
      if (msg) for (const p of this.moderators()) this.send(p.ws, msg);
      return new Response("ok");
    }

    if (this.state.getWebSockets().length >= MAX_PEERS) return new Response("Room is full.", { status: 503 });

    const url = new URL(request.url);
    const wanted = (url.searchParams.get("name") || "").trim().slice(0, 40);
    const email = (url.searchParams.get("email") || "").slice(0, 120);
    const guest = url.searchParams.get("guest") === "1";
    const skip = url.searchParams.get("skip") === "1"; // skip waiting (breakout re-join)
    const main = (url.searchParams.get("main") || "").slice(0, 64); // set inside a breakout

    // A Durable Object cannot see the name it was looked up by, but breakout
    // plumbing needs it, so remember it from the path the Worker forwarded.
    const selfRoom = (url.pathname.match(/^\/api\/room\/([A-Za-z0-9_-]{1,64})\/ws$/) || [])[1];
    if (selfRoom) { this.selfRoomName = selfRoom; await this.state.storage.put("selfRoom", selfRoom); }

    let seq = (await this.state.storage.get("seq")) || 0;
    seq += 1;
    await this.state.storage.put("seq", seq);

    // A one-link caller arrives without a name. The room gives them one, so
    // the roster reads "Caller 2" rather than a blank label, and seq already
    // counts arrivals so no two callers collide.
    const name = wanted || "Caller " + seq;

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (main) await this.state.storage.put("mainRoom", main);
    server.serializeAttachment({
      connId: crypto.randomUUID(), name, email, guest, skip, seq,
      admitted: false, grantShare: false, grantRecord: false, moderator: false,
    });
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- helpers ------------------------------------------------------------
  meta(ws) { return ws.deserializeAttachment() || {}; }
  setMeta(ws, patch) { const n = { ...this.meta(ws), ...patch }; ws.serializeAttachment(n); return n; }
  peers() { return this.state.getWebSockets().map((ws) => ({ ws, ...this.meta(ws) })); }
  admittedPeers() { return this.peers().filter((p) => p.admitted); }

  hostId(owner) {
    for (const p of this.admittedPeers()) if (p.email && owner && p.email === owner) return p.connId;
    return null;
  }
  hostSocket(owner) {
    for (const p of this.admittedPeers()) if (p.email && owner && p.email === owner) return p;
    return null;
  }
  // Everyone who can act on the meeting: the host plus any co-hosts.
  moderators() { return this.admittedPeers().filter((p) => p.moderator); }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  toId(id, obj) { const t = this.peers().find((p) => p.connId === id); if (t) this.send(t.ws, obj); }

  broadcast(obj, exceptId) {
    const data = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (exceptId && this.meta(ws).connId === exceptId) continue;
      try { ws.send(data); } catch {}
    }
  }
  broadcastAdmitted(obj, exceptId) {
    const data = JSON.stringify(obj);
    for (const p of this.admittedPeers()) {
      if (exceptId && p.connId === exceptId) continue;
      try { p.ws.send(data); } catch {}
    }
  }

  async loadBoard() {
    const map = await this.state.storage.list({ prefix: "shape:" });
    return [...map.values()];
  }

  // Wipe everything that belonged to the meeting that just ended, so the next
  // meeting in this room starts from a clean slate. The room's identity — who
  // owns it and how people get in — is deliberately kept.
  async resetSession() {
    const shapes = await this.state.storage.list({ prefix: "shape:" });
    if (shapes.size) await this.state.storage.delete([...shapes.keys()]);
    await this.state.storage.delete(SESSION_KEYS);
  }

  // Is this person a moderator? The host always is; co-hosts are remembered by
  // email so the role survives their reconnect.
  async resolveModerator(ws) {
    const self = this.meta(ws);
    const owner = await this.state.storage.get("owner");
    if (!self.guest && owner && self.email === owner) return this.setMeta(ws, { moderator: true });
    const cohosts = (await this.state.storage.get("cohosts")) || [];
    if (!self.guest && self.email && cohosts.includes(self.email)) return this.setMeta(ws, { moderator: true });
    return self;
  }

  async admitSend(ws) {
    await this.resolveModerator(ws);
    const self = this.meta(ws);
    const owner = await this.state.storage.get("owner");
    const waiting = (await this.state.storage.get("waiting")) !== false;
    const others = this.admittedPeers().filter((p) => p.connId !== self.connId)
      .map((p) => ({ id: p.connId, name: p.name, moderator: !!p.moderator }));
    const board = await this.loadBoard();
    const allowDraw = (await this.state.storage.get("allowDraw")) === true;
    const allowShare = (await this.state.storage.get("allowShare")) === true;
    const boardOn = (await this.state.storage.get("boardOn")) === true;
    const boardBg = (await this.state.storage.get("boardBg")) || DEFAULT_BG;
    const started = (await this.state.storage.get("started")) === true;
    const spotlight = (await this.state.storage.get("spotlight")) || null;
    const muteOnEntry = (await this.state.storage.get("muteOnEntry")) === true;
    const cohosts = (await this.state.storage.get("cohosts")) || [];
    const mainRoom = (await this.state.storage.get("mainRoom")) || null;
    const breakouts = (await this.state.storage.get("breakouts")) || [];
    const breakoutEndsAt = (await this.state.storage.get("breakoutEndsAt")) || null;
    const amHost = !self.guest && owner && self.email === owner;
    // The clock starts when the first person is admitted.
    let startedAt = await this.state.storage.get("startedAt");
    if (!startedAt) { startedAt = Date.now(); await this.state.storage.put("startedAt", startedAt); }
    this.send(ws, {
      type: "welcome", self: self.connId, name: self.name, host: this.hostId(owner), owner: owner || null,
      peers: others.map((p) => ({ ...p })), board, waiting, allowDraw, allowShare,
      boardOn, boardBg, spotlight, startedAt, mainRoom, breakouts, breakoutEndsAt,
      // Mute-on-entry applies to everyone but the moderators running the meeting.
      muteOnEntry: muteOnEntry && !self.moderator,
      moderator: !!self.moderator, isHost: !!amHost, cohosts,
      // The global toggles and this person's individual grants are reported
      // separately so the client can recompute when either one changes.
      grantShare: !!self.grantShare, grantRecord: !!self.grantRecord,
      canDraw: self.moderator || allowDraw, canShare: self.moderator || allowShare || self.grantShare,
      canRecord: self.moderator || self.grantRecord,
    });
    this.broadcastAdmitted({ type: "peer-join", id: self.connId, name: self.name, moderator: !!self.moderator }, self.connId);
    // Anyone parked on "not started yet" can try again now the host is here.
    if (self.moderator) {
      for (const p of this.peers()) if (!p.admitted && p.connId !== self.connId) this.send(p.ws, { type: "meeting-open" });
    }
    // Moderators need to see anyone already waiting.
    if (self.moderator) {
      for (const p of this.peers()) {
        if (!p.admitted && p.connId !== self.connId) this.send(ws, { type: "wait-request", id: p.connId, name: p.name });
      }
    }
  }

  // --- lifecycle ----------------------------------------------------------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const self = this.meta(ws);
    const owner = await this.state.storage.get("owner");
    const isHost = !self.guest && !!owner && self.email === owner;
    // Co-hosts share every power except ending the meeting and managing
    // co-hosts, so nearly every check below is on isModerator.
    const isModerator = isHost || !!self.moderator;

    if (msg.type === "hello") {
      let own = owner;
      const canOwn = !self.guest && self.email;
      if (!own && canOwn) {
        own = self.email;
        await this.state.storage.put("owner", own);
        // The first non-guest through the door creates the room, so their
        // chosen access mode configures it (only if nothing set it already).
        if ((await this.state.storage.get("waiting")) === undefined && (msg.access === "open" || msg.access === "approval")) {
          await this.state.storage.put("waiting", msg.access === "approval");
        }
      }
      const amOwner = canOwn && own === self.email;
      const waiting = (await this.state.storage.get("waiting")) !== false;
      const host = this.hostId(own);

      // The owner arriving is what opens the meeting.
      if (amOwner) await this.state.storage.put("started", true);
      const started = (await this.state.storage.get("started")) === true;

      // An invite link is not a key to a meeting that was never opened. Once
      // it HAS been opened the room stays open, so people can gather without
      // the host in the room — which is the whole point of a one-link call.
      // skip=1 means the meeting itself is placing them (a breakout room).
      if (!amOwner && !self.skip && !started) {
        this.send(ws, { type: "not-started" });
        return;
      }
      if (amOwner || self.skip || !waiting) {
        this.setMeta(ws, { admitted: true });
        await this.admitSend(ws);
      } else {
        this.send(ws, { type: "waiting" });
        this.toId(host, { type: "wait-request", id: self.connId, name: self.name });
      }
      return;
    }

    // Everything else requires an admitted participant.
    if (!self.admitted) return;

    const allowDraw = (await this.state.storage.get("allowDraw")) === true;
    const allowShare = (await this.state.storage.get("allowShare")) === true;
    const canDraw = isModerator || allowDraw;
    const canShare = isModerator || allowShare || self.grantShare;

    switch (msg.type) {
      case "signal": this.toId(msg.to, { type: "signal", from: self.connId, name: self.name, data: msg.data }); break;

      // Screen-share on/off announcement (so peers route it to the main stage).
      case "screen":
        if (msg.on && !canShare) { this.send(ws, { type: "share-decision", ok: false, by: "the host" }); break; }
        this.broadcastAdmitted({ type: "screen", id: self.connId, name: self.name, on: !!msg.on, streamId: msg.streamId || null }, self.connId);
        break;

      case "draw":
        if (!canDraw) break;
        // Persist (best-effort; a very large image still broadcasts live).
        if (msg.shape && msg.shape.id) { try { await this.state.storage.put("shape:" + msg.shape.id, msg.shape); } catch {} }
        this.broadcastAdmitted({ type: "draw", shape: msg.shape }, self.connId);
        break;
      case "erase":
        if (!canDraw) break;
        if (msg.id) await this.state.storage.delete("shape:" + msg.id);
        this.broadcastAdmitted({ type: "erase", id: msg.id }, self.connId);
        break;
      case "clear": {
        if (!canDraw) break;
        const map = await this.state.storage.list({ prefix: "shape:" });
        await this.state.storage.delete([...map.keys()]);
        this.broadcastAdmitted({ type: "clear" }, self.connId);
        break;
      }
      case "cursor":
        this.broadcastAdmitted({ type: "cursor", id: self.connId, name: self.name, x: msg.x, y: msg.y }, self.connId);
        break;

      case "chat": {
        const out = { type: "chat", id: self.connId, name: self.name, text: String(msg.text || "").slice(0, 2000), to: msg.to || null };
        if (msg.to) this.toId(msg.to, out); else this.broadcastAdmitted(out, self.connId);
        break;
      }
      case "media": this.broadcastAdmitted({ type: "media", id: self.connId, mic: !!msg.mic, cam: !!msg.cam }, self.connId); break;
      case "hand": this.broadcastAdmitted({ type: "hand", id: self.connId, name: self.name, up: !!msg.up }, self.connId); break;
      case "react": this.broadcastAdmitted({ type: "react", id: self.connId, name: self.name, emoji: String(msg.emoji || "👍").slice(0, 8) }, self.connId); break;

      // ---- ask the host for permission ----
      case "share-request": {
        if (canShare) { this.send(ws, { type: "share-decision", ok: true, by: "" }); break; }
        const host = this.hostSocket(owner);
        if (!host) { this.send(ws, { type: "share-decision", ok: false, by: "" }); break; }
        this.send(host.ws, { type: "share-request", id: self.connId, name: self.name });
        break;
      }
      case "record-request": {
        if (isModerator || self.grantRecord) { this.send(ws, { type: "record-decision", ok: true, by: "" }); break; }
        const host = this.hostSocket(owner);
        if (!host) { this.send(ws, { type: "record-decision", ok: false, by: "" }); break; }
        this.send(host.ws, { type: "record-request", id: self.connId, name: self.name });
        break;
      }
      // Turning the whiteboard on is the host's call, so anyone else asks.
      case "board-request": {
        if (isModerator) {
          await this.state.storage.put("boardOn", true);
          this.broadcastAdmitted({ type: "board-state", on: true });
          break;
        }
        const host = this.hostSocket(owner);
        if (!host) { this.send(ws, { type: "board-decision", ok: false, by: "" }); break; }
        this.send(host.ws, { type: "board-request", id: self.connId, name: self.name });
        break;
      }
      case "board-decision": {
        if (!isModerator) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t) break;
        if (msg.ok) {
          await this.state.storage.put("boardOn", true);
          this.broadcastAdmitted({ type: "board-state", on: true });
        }
        this.send(t.ws, { type: "board-decision", ok: !!msg.ok, by: self.name });
        break;
      }

      // A recording is starting or stopping. Permission is consumed on start,
      // so every separate recording needs the host to approve it again.
      case "recording": {
        if (msg.on) {
          if (!isModerator && !self.grantRecord) { this.send(ws, { type: "record-decision", ok: false, by: "" }); break; }
          if (!isModerator) this.setMeta(ws, { grantRecord: false });
        }
        this.broadcastAdmitted({ type: "recording-state", id: self.connId, name: self.name, on: !!msg.on });
        break;
      }
      case "share-decision": {
        if (!isModerator) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t) break;
        this.setMeta(t.ws, { grantShare: !!msg.ok });
        this.send(t.ws, { type: "share-decision", ok: !!msg.ok, by: self.name });
        break;
      }
      case "record-decision": {
        if (!isModerator) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t) break;
        this.setMeta(t.ws, { grantRecord: !!msg.ok });
        this.send(t.ws, { type: "record-decision", ok: !!msg.ok, by: self.name });
        break;
      }

      // ---- host-only controls ----
      case "host-mute":
        if (!isModerator) break;
        if (msg.target === "all") {
          for (const p of this.admittedPeers()) if (p.connId !== self.connId) this.send(p.ws, { type: "force-mute", by: self.name });
        } else this.toId(msg.target, { type: "force-mute", by: self.name });
        break;
      case "hand-lower-all":
        if (!isModerator) break;
        this.broadcastAdmitted({ type: "hand-lower-all" });
        break;
      case "host-remove":
        if (!isModerator) break;
        this.toId(msg.target, { type: "removed", by: self.name });
        break;
      case "admit": {
        if (!isModerator) break;
        const t = this.peers().find((p) => p.connId === msg.id && !p.admitted);
        if (t) { this.setMeta(t.ws, { admitted: true }); await this.admitSend(t.ws); }
        break;
      }
      case "deny": {
        if (!isModerator) break;
        const t = this.peers().find((p) => p.connId === msg.id && !p.admitted);
        if (t) { this.send(t.ws, { type: "denied" }); try { t.ws.close(1000, "denied"); } catch {} }
        break;
      }
      case "waiting-toggle":
        if (!isModerator) break;
        await this.state.storage.put("waiting", !!msg.on);
        this.broadcastAdmitted({ type: "waiting-state", on: !!msg.on });
        break;
      case "allow-draw":
        if (!isModerator) break;
        await this.state.storage.put("allowDraw", !!msg.on);
        this.broadcastAdmitted({ type: "perm", what: "draw", on: !!msg.on });
        break;
      case "allow-share":
        if (!isModerator) break;
        await this.state.storage.put("allowShare", !!msg.on);
        this.broadcastAdmitted({ type: "perm", what: "share", on: !!msg.on });
        break;

      // ---- shared surface state (host-controlled, everyone follows) ----
      case "board-toggle": {
        if (!isModerator) break;
        const on = !!msg.on;
        await this.state.storage.put("boardOn", on);
        this.broadcastAdmitted({ type: "board-state", on });
        break;
      }
      case "board-bg": {
        if (!isModerator) break;
        const bg = String(msg.bg || DEFAULT_BG).slice(0, 20);
        await this.state.storage.put("boardBg", bg);
        this.broadcastAdmitted({ type: "board-bg", bg });
        break;
      }
      case "spotlight": {
        if (!isModerator) break;
        const target = msg.target ? String(msg.target).slice(0, 64) : null;
        if (target) await this.state.storage.put("spotlight", target);
        else await this.state.storage.delete("spotlight");
        this.broadcastAdmitted({ type: "spotlight", id: target });
        break;
      }

      // ---- co-hosts (host only) ----
      case "cohost": {
        if (!isHost) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t || t.guest === undefined) break;
        const on = !!msg.on;
        this.setMeta(t.ws, { moderator: on });
        // Remember by email so the role survives their reconnect. A guest has
        // no stable identity, so their co-host role lasts only this connection.
        if (t.email && !t.guest) {
          const list = new Set((await this.state.storage.get("cohosts")) || []);
          on ? list.add(t.email) : list.delete(t.email);
          await this.state.storage.put("cohosts", [...list]);
        }
        this.send(t.ws, { type: "cohost", on, by: self.name });
        this.broadcastAdmitted({ type: "peer-role", id: t.connId, moderator: on });
        break;
      }

      // ---- rename yourself ----
      case "rename": {
        const name = String(msg.name || "").trim().slice(0, 40);
        if (!name || name === self.name) break;
        this.setMeta(ws, { name });
        this.broadcastAdmitted({ type: "renamed", id: self.connId, name });
        break;
      }

      // ---- mute people as they arrive ----
      case "mute-on-entry": {
        if (!isModerator) break;
        await this.state.storage.put("muteOnEntry", !!msg.on);
        this.broadcastAdmitted({ type: "mute-on-entry", on: !!msg.on });
        break;
      }

      // ---- chat attachments, relayed in slices and never stored ----
      case "file-start": {
        if (!msg.fileId) break;
        const size = Number(msg.size) || 0;
        if (size <= 0 || size > MAX_FILE_BYTES) {
          this.send(ws, { type: "file-error", fileId: msg.fileId, error: "That file is too large (10 MB max)." });
          break;
        }
        const out = {
          type: "file-start", id: self.connId, name: self.name, to: msg.to || null,
          fileId: String(msg.fileId).slice(0, 64), fileName: String(msg.fileName || "file").slice(0, 200),
          mime: String(msg.mime || "application/octet-stream").slice(0, 120), size, chunks: Number(msg.chunks) || 1,
        };
        if (msg.to) this.toId(msg.to, out); else this.broadcastAdmitted(out, self.connId);
        break;
      }
      case "file-chunk": {
        if (!msg.fileId) break;
        const out = { type: "file-chunk", id: self.connId, fileId: msg.fileId, i: Number(msg.i) || 0, data: msg.data, to: msg.to || null };
        if (msg.to) this.toId(msg.to, out); else this.broadcastAdmitted(out, self.connId);
        break;
      }

      case "end-session":
        if (!isHost) break; // ending the meeting stays with the host alone
        this.broadcast({ type: "session-end" });
        await this.resetSession();
        // Drop every socket so nobody lingers in a meeting that has ended.
        for (const p of this.peers()) { try { p.ws.close(1000, "meeting ended"); } catch {} }
        break;

      // ---- breakout rooms ----
      case "breakout-open": {
        if (!isModerator) break;
        const rooms = (Array.isArray(msg.rooms) ? msg.rooms : []).slice(0, 20);
        if (!rooms.length) break;
        const minutes = Math.max(0, Math.min(180, Number(msg.minutes) || 0));
        const endsAt = minutes ? Date.now() + minutes * 60_000 : null;
        const cohosts = (await this.state.storage.get("cohosts")) || [];
        const roomIds = rooms.map((r) => r.room);
        await this.state.storage.put("breakouts", rooms.map((r) => ({ room: r.room, name: r.name })));
        if (endsAt) {
          await this.state.storage.put("breakoutEndsAt", endsAt);
          // A Durable Object alarm closes the rooms even if the moderator's
          // browser is closed, so a timed session can't be left hanging.
          await this.state.storage.setAlarm(endsAt);
        } else {
          await this.state.storage.delete("breakoutEndsAt");
          await this.state.storage.deleteAlarm();
        }

        // Give every sub-room this meeting's identity, so the moderators are
        // moderators in there and members are not held in a waiting room.
        // Without this the first person into a breakout became its host.
        for (const r of rooms) {
          await this.configureSubRoom(r.room, owner, cohosts, endsAt);
        }
        for (const r of rooms) {
          for (const id of r.members || []) {
            this.toId(id, { type: "breakout-open", room: r.room, roomName: r.name, endsAt });
          }
        }
        this.broadcastAdmitted({ type: "breakout-state", rooms: rooms.map((r) => ({ room: r.room, name: r.name })), endsAt });
        break;
      }
      // Send one person to a specific room (or back to the main room).
      case "breakout-move": {
        if (!isModerator) break;
        const endsAt = (await this.state.storage.get("breakoutEndsAt")) || null;
        const payload = msg.room
          ? { type: "breakout-open", room: msg.room, roomName: msg.roomName || msg.room, endsAt }
          : { type: "breakout-close" };
        // They may be sitting in a sub-room rather than here.
        if (msg.from) await this.relayInto(msg.from, msg.target, payload);
        else this.toId(msg.target, payload);
        break;
      }
      // Someone inside a breakout asking to be somewhere else. The moderators
      // are back in the main room, so forward it there.
      case "breakout-ask": {
        const mainRoom = await this.state.storage.get("mainRoom");
        const selfRoom = await this.state.storage.get("selfRoom");
        const req = {
          type: "breakout-ask", id: self.connId, name: self.name,
          room: String(msg.room || "").slice(0, 64), from: selfRoom || null,
        };
        // In a breakout the moderators are back in the main room; in the main
        // room they are right here.
        if (mainRoom) await this.forwardToMain(mainRoom, req);
        else for (const p of this.moderators()) this.send(p.ws, req);
        break;
      }
      case "breakout-announce": {
        if (!isModerator) break;
        const text = String(msg.text || "").slice(0, 500);
        if (!text) break;
        const rooms = (await this.state.storage.get("breakouts")) || [];
        const out = { type: "breakout-announce", text, by: self.name };
        for (const r of rooms) {
          try {
            const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(r.room || r));
            await stub.fetch(new Request("https://do/internal", { method: "POST", headers: { "X-Internal": "broadcast" }, body: JSON.stringify(out) }));
          } catch {}
        }
        this.broadcastAdmitted(out);
        break;
      }
      case "breakout-close": {
        if (!isModerator) break;
        await this.closeBreakouts();
        break;
      }
    }
  }

  // Hand a sub-room the meeting's identity so it behaves like part of this
  // meeting rather than a brand new room of its own.
  async configureSubRoom(room, owner, cohosts, endsAt) {
    try {
      const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(room));
      await stub.fetch(new Request("https://do/set-owner", {
        method: "POST",
        headers: { "X-Internal": "set-owner" },
        body: JSON.stringify({
          email: owner, access: "open", cohosts,
          mainRoom: this.selfRoomName || (await this.state.storage.get("selfRoom")), endsAt,
        }),
      }));
    } catch {}
  }

  async relayInto(room, id, msg) {
    try {
      const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(room));
      await stub.fetch(new Request("https://do/internal", {
        method: "POST", headers: { "X-Internal": "relay-to" }, body: JSON.stringify({ id, msg }),
      }));
    } catch {}
  }

  async forwardToMain(mainRoom, msg) {
    try {
      const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(mainRoom));
      await stub.fetch(new Request("https://do/internal", {
        method: "POST", headers: { "X-Internal": "forward-request" }, body: JSON.stringify(msg),
      }));
    } catch {}
  }

  async closeBreakouts() {
    const rooms = (await this.state.storage.get("breakouts")) || [];
    for (const r of rooms) {
      try {
        const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(r.room || r));
        await stub.fetch(new Request("https://do/internal", { method: "POST", headers: { "X-Internal": "broadcast" }, body: JSON.stringify({ type: "breakout-close" }) }));
      } catch {}
    }
    await this.state.storage.delete(["breakouts", "breakoutEndsAt"]);
    await this.state.storage.deleteAlarm();
    this.broadcastAdmitted({ type: "breakout-state", rooms: [], endsAt: null });
  }

  // Fires when a timed breakout session runs out.
  async alarm() {
    const endsAt = await this.state.storage.get("breakoutEndsAt");
    if (!endsAt) return;
    await this.closeBreakouts();
  }

  async webSocketClose(ws) {
    const self = this.meta(ws);
    if (self.admitted) {
      this.broadcastAdmitted({ type: "peer-leave", id: self.connId }, self.connId);
      const owner = await this.state.storage.get("owner");
      const host = this.hostId(owner);
      this.broadcastAdmitted({ type: "host", id: host });
      // A spotlight on someone who has left is meaningless — clear it.
      const spot = await this.state.storage.get("spotlight");
      if (spot && spot === self.connId) {
        await this.state.storage.delete("spotlight");
        this.broadcastAdmitted({ type: "spotlight", id: null });
      }
    }
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}
