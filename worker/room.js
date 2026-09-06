// RoomDurableObject: one instance per meeting room.
//
//   1. WebRTC signaling relay (mesh) + whiteboard broadcast/persistence.
//   2. Meeting control: OWNER-based host, waiting room + admit, mute,
//      raise/lower hands, reactions, media state, public/private chat.
//   3. Breakout rooms: relays participants to sub-rooms and can recall them.
//
// The host is the meeting OWNER (the account that created/scheduled it), not
// whoever joined first. The owner is remembered, so the host is stable across
// reconnects and returns.

const MAX_PEERS = 20;

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
      const { email } = await request.json().catch(() => ({}));
      if (email) await this.state.storage.put("owner", email);
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
    server.serializeAttachment({ connId: crypto.randomUUID(), name, email, guest, skip, seq, admitted: false });
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

  async admitSend(ws) {
    const self = this.meta(ws);
    const owner = await this.state.storage.get("owner");
    const waiting = (await this.state.storage.get("waiting")) !== false;
    const others = this.admittedPeers().filter((p) => p.connId !== self.connId).map((p) => ({ id: p.connId, name: p.name }));
    const board = await this.loadBoard();
    const allowDraw = (await this.state.storage.get("allowDraw")) === true;
    const allowShare = (await this.state.storage.get("allowShare")) === true;
    const amHost = !self.guest && owner && self.email === owner;
    this.send(ws, { type: "welcome", self: self.connId, host: this.hostId(owner), owner: owner || null, peers: others, board, waiting, allowDraw, allowShare, canDraw: amHost || allowDraw, canShare: amHost || allowShare });
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
      if (!own && canOwn) { own = self.email; await this.state.storage.put("owner", own); }
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
    const canDraw = isHost || allowDraw;

    switch (msg.type) {
      case "signal": this.toId(msg.to, { type: "signal", from: self.connId, name: self.name, data: msg.data }); break;

      // Screen-share on/off announcement (so peers route it to the main stage).
      case "screen": this.broadcastAdmitted({ type: "screen", id: self.connId, name: self.name, on: !!msg.on, streamId: msg.streamId || null }, self.connId); break;

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
      case "end-session":
        if (!isHost) break;
        this.broadcast({ type: "session-end" });
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
    }
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}
