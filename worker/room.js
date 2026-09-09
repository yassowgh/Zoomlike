// RoomDurableObject: one instance per meeting room.
//
//   1. WebRTC signaling relay (mesh) + whiteboard broadcast/persistence.
//   2. Meeting control: OWNER-based host, waiting room + admit, mute,
//      raise/lower hands, reactions, media state, public/private chat.
//   3. Shared meeting surface state: whiteboard on/off, board background,
//      spotlight — all host-controlled and mirrored to everyone.
//   4. Per-user requests: share screen / record need the host's approval
//      unless the host has opened them up for everyone.
//   5. Breakout rooms: relays participants to sub-rooms and can recall them.
//
// The host is the meeting OWNER (the account that created/scheduled it), not
// whoever joined first. The owner is remembered, so the host is stable across
// reconnects and returns.

const MAX_PEERS = 20;

// Room state belonging to a single SESSION, wiped when the host ends the
// meeting. Everything else ("owner", "waiting", "seq") describes the room
// itself and deliberately survives.
const SESSION_KEYS = ["breakouts", "allowDraw", "allowShare", "spotlight", "boardOn", "boardBg"];

const DEFAULT_BG = "dark";

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
      const { email, access } = await request.json().catch(() => ({}));
      if (email) await this.state.storage.put("owner", email);
      // "open"  -> anyone with the link walks straight in.
      // "approval" -> the host admits each person from the waiting room.
      if (access === "open" || access === "approval") {
        await this.state.storage.put("waiting", access === "approval");
      }
      return new Response("ok");
    }

    if (this.state.getWebSockets().length >= MAX_PEERS) return new Response("Room is full.", { status: 503 });

    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "Guest").slice(0, 40);
    const email = (url.searchParams.get("email") || "").slice(0, 120);
    const guest = url.searchParams.get("guest") === "1";
    const skip = url.searchParams.get("skip") === "1"; // skip waiting (breakout re-join)

    let seq = (await this.state.storage.get("seq")) || 0;
    seq += 1;
    await this.state.storage.put("seq", seq);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.serializeAttachment({
      connId: crypto.randomUUID(), name, email, guest, skip, seq,
      admitted: false, grantShare: false, grantRecord: false,
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

  async admitSend(ws) {
    const self = this.meta(ws);
    const owner = await this.state.storage.get("owner");
    const waiting = (await this.state.storage.get("waiting")) !== false;
    const others = this.admittedPeers().filter((p) => p.connId !== self.connId).map((p) => ({ id: p.connId, name: p.name }));
    const board = await this.loadBoard();
    const allowDraw = (await this.state.storage.get("allowDraw")) === true;
    const allowShare = (await this.state.storage.get("allowShare")) === true;
    const boardOn = (await this.state.storage.get("boardOn")) !== false;
    const boardBg = (await this.state.storage.get("boardBg")) || DEFAULT_BG;
    const spotlight = (await this.state.storage.get("spotlight")) || null;
    const amHost = !self.guest && owner && self.email === owner;
    this.send(ws, {
      type: "welcome", self: self.connId, host: this.hostId(owner), owner: owner || null,
      peers: others, board, waiting, allowDraw, allowShare, boardOn, boardBg, spotlight,
      // The global toggles and this person's individual grants are reported
      // separately so the client can recompute when either one changes.
      grantShare: !!self.grantShare, grantRecord: !!self.grantRecord,
      canDraw: amHost || allowDraw, canShare: amHost || allowShare || self.grantShare,
      canRecord: amHost || self.grantRecord,
    });
    this.broadcastAdmitted({ type: "peer-join", id: self.connId, name: self.name }, self.connId);
    // If this is the host, tell them about anyone already waiting.
    if (!self.guest && owner && self.email === owner) {
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
      if (amOwner || self.skip || !waiting || !host) {
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
    const canDraw = isHost || allowDraw;
    const canShare = isHost || allowShare || self.grantShare;

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
        if (isHost || self.grantRecord) { this.send(ws, { type: "record-decision", ok: true, by: "" }); break; }
        const host = this.hostSocket(owner);
        if (!host) { this.send(ws, { type: "record-decision", ok: false, by: "" }); break; }
        this.send(host.ws, { type: "record-request", id: self.connId, name: self.name });
        break;
      }
      // Turning the whiteboard on is the host's call, so anyone else asks.
      case "board-request": {
        if (isHost) {
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
        if (!isHost) break;
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
          if (!isHost && !self.grantRecord) { this.send(ws, { type: "record-decision", ok: false, by: "" }); break; }
          if (!isHost) this.setMeta(ws, { grantRecord: false });
        }
        this.broadcastAdmitted({ type: "recording-state", id: self.connId, name: self.name, on: !!msg.on });
        break;
      }
      case "share-decision": {
        if (!isHost) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t) break;
        this.setMeta(t.ws, { grantShare: !!msg.ok });
        this.send(t.ws, { type: "share-decision", ok: !!msg.ok, by: self.name });
        break;
      }
      case "record-decision": {
        if (!isHost) break;
        const t = this.peers().find((p) => p.connId === msg.target);
        if (!t) break;
        this.setMeta(t.ws, { grantRecord: !!msg.ok });
        this.send(t.ws, { type: "record-decision", ok: !!msg.ok, by: self.name });
        break;
      }

      // ---- host-only controls ----
      case "host-mute":
        if (!isHost) break;
        if (msg.target === "all") {
          for (const p of this.admittedPeers()) if (p.connId !== self.connId) this.send(p.ws, { type: "force-mute", by: self.name });
        } else this.toId(msg.target, { type: "force-mute", by: self.name });
        break;
      case "hand-lower-all":
        if (!isHost) break;
        this.broadcastAdmitted({ type: "hand-lower-all" });
        break;
      case "host-remove":
        if (!isHost) break;
        this.toId(msg.target, { type: "removed", by: self.name });
        break;
      case "admit": {
        if (!isHost) break;
        const t = this.peers().find((p) => p.connId === msg.id && !p.admitted);
        if (t) { this.setMeta(t.ws, { admitted: true }); await this.admitSend(t.ws); }
        break;
      }
      case "deny": {
        if (!isHost) break;
        const t = this.peers().find((p) => p.connId === msg.id && !p.admitted);
        if (t) { this.send(t.ws, { type: "denied" }); try { t.ws.close(1000, "denied"); } catch {} }
        break;
      }
      case "waiting-toggle":
        if (!isHost) break;
        await this.state.storage.put("waiting", !!msg.on);
        this.broadcastAdmitted({ type: "waiting-state", on: !!msg.on });
        break;
      case "allow-draw":
        if (!isHost) break;
        await this.state.storage.put("allowDraw", !!msg.on);
        this.broadcastAdmitted({ type: "perm", what: "draw", on: !!msg.on });
        break;
      case "allow-share":
        if (!isHost) break;
        await this.state.storage.put("allowShare", !!msg.on);
        this.broadcastAdmitted({ type: "perm", what: "share", on: !!msg.on });
        break;

      // ---- shared surface state (host-controlled, everyone follows) ----
      case "board-toggle": {
        if (!isHost) break;
        const on = !!msg.on;
        await this.state.storage.put("boardOn", on);
        this.broadcastAdmitted({ type: "board-state", on });
        break;
      }
      case "board-bg": {
        if (!isHost) break;
        const bg = String(msg.bg || DEFAULT_BG).slice(0, 20);
        await this.state.storage.put("boardBg", bg);
        this.broadcastAdmitted({ type: "board-bg", bg });
        break;
      }
      case "spotlight": {
        if (!isHost) break;
        const target = msg.target ? String(msg.target).slice(0, 64) : null;
        if (target) await this.state.storage.put("spotlight", target);
        else await this.state.storage.delete("spotlight");
        this.broadcastAdmitted({ type: "spotlight", id: target });
        break;
      }

      case "end-session":
        if (!isHost) break;
        this.broadcast({ type: "session-end" });
        await this.resetSession();
        // Drop every socket so nobody lingers in a meeting that has ended.
        for (const p of this.peers()) { try { p.ws.close(1000, "meeting ended"); } catch {} }
        break;

      // ---- breakout rooms ----
      case "breakout-open": {
        if (!isHost) break;
        const rooms = Array.isArray(msg.rooms) ? msg.rooms : [];
        await this.state.storage.put("breakouts", rooms.map((r) => r.room));
        for (const r of rooms) {
          for (const id of r.members || []) this.toId(id, { type: "breakout-open", room: r.room, roomName: r.name });
        }
        break;
      }
      case "breakout-close": {
        if (!isHost) break;
        const rooms = (await this.state.storage.get("breakouts")) || [];
        for (const sub of rooms) {
          try {
            const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(sub));
            await stub.fetch(new Request("https://do/internal", { method: "POST", headers: { "X-Internal": "broadcast" }, body: JSON.stringify({ type: "breakout-close" }) }));
          } catch {}
        }
        await this.state.storage.delete("breakouts");
        break;
      }
    }
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
