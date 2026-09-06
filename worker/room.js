// RoomDurableObject: one instance per meeting room.
//
//   1. WebRTC signaling relay  — offer/answer/ICE between peers (mesh).
//   2. Whiteboard broadcast + persistence.
//   3. Meeting control         — host role, mute (all/one), raise hand,
//      reactions, media state, and public/private chat routing.
//
// Uses the hibernatable WebSocket API so idle rooms cost nothing.

const MAX_PEERS = 16;

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (this.state.getWebSockets().length >= MAX_PEERS) {
      return new Response("Room is full.", { status: 503 });
    }
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "Guest").slice(0, 40);
    const email = (url.searchParams.get("email") || "").slice(0, 120);

    // Monotonic join sequence → the lowest still-connected seq is the host.
    let seq = (await this.state.storage.get("seq")) || 0;
    seq += 1;
    await this.state.storage.put("seq", seq);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.serializeAttachment({ connId: crypto.randomUUID(), name, email, seq });
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- helpers ------------------------------------------------------------
  meta(ws) { return ws.deserializeAttachment() || {}; }

  peers() {
    return this.state.getWebSockets().map((ws) => ({ ws, ...this.meta(ws) }));
  }

  hostId() {
    let host = null, min = Infinity;
    for (const p of this.peers()) {
      if (typeof p.seq === "number" && p.seq < min) { min = p.seq; host = p.connId; }
    }
    return host;
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

  broadcast(obj, exceptId) {
    const data = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (exceptId && this.meta(ws).connId === exceptId) continue;
      try { ws.send(data); } catch {}
    }
  }

  toId(id, obj) {
    const t = this.peers().find((p) => p.connId === id);
    if (t) this.send(t.ws, obj);
  }

  async loadBoard() {
    const map = await this.state.storage.list({ prefix: "shape:" });
    return [...map.values()];
  }

  // --- lifecycle ----------------------------------------------------------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const self = this.meta(ws);
    const isHost = this.hostId() === self.connId;

    switch (msg.type) {
      case "hello": {
        const others = this.peers()
          .filter((p) => p.connId !== self.connId)
          .map((p) => ({ id: p.connId, name: p.name }));
        const board = await this.loadBoard();
        this.send(ws, { type: "welcome", self: self.connId, host: this.hostId(), peers: others, board });
        this.broadcast({ type: "peer-join", id: self.connId, name: self.name }, self.connId);
        break;
      }

      case "signal": {
        this.toId(msg.to, { type: "signal", from: self.connId, name: self.name, data: msg.data });
        break;
      }

      case "draw": {
        if (msg.shape && msg.shape.id) await this.state.storage.put("shape:" + msg.shape.id, msg.shape);
        this.broadcast({ type: "draw", shape: msg.shape }, self.connId);
        break;
      }
      case "erase": {
        if (msg.id) await this.state.storage.delete("shape:" + msg.id);
        this.broadcast({ type: "erase", id: msg.id }, self.connId);
        break;
      }
      case "clear": {
        const map = await this.state.storage.list({ prefix: "shape:" });
        await this.state.storage.delete([...map.keys()]);
        this.broadcast({ type: "clear" }, self.connId);
        break;
      }
      case "cursor": {
        this.broadcast({ type: "cursor", id: self.connId, name: self.name, x: msg.x, y: msg.y }, self.connId);
        break;
      }

      // Public (to === null) or private chat (to === a connId).
      case "chat": {
        const out = { type: "chat", id: self.connId, name: self.name, text: String(msg.text || "").slice(0, 2000), to: msg.to || null };
        if (msg.to) this.toId(msg.to, out);
        else this.broadcast(out, self.connId);
        break;
      }

      // Roster: broadcast mic/cam state so everyone's list stays current.
      case "media": {
        this.broadcast({ type: "media", id: self.connId, mic: !!msg.mic, cam: !!msg.cam }, self.connId);
        break;
      }
      case "hand": {
        this.broadcast({ type: "hand", id: self.connId, name: self.name, up: !!msg.up }, self.connId);
        break;
      }
      case "react": {
        this.broadcast({ type: "react", id: self.connId, name: self.name, emoji: String(msg.emoji || "👍").slice(0, 8) }, self.connId);
        break;
      }

      // Host-only: force-mute everyone or one participant.
      case "host-mute": {
        if (!isHost) break;
        if (msg.target === "all") {
          for (const p of this.peers()) {
            if (p.connId !== self.connId) this.send(p.ws, { type: "force-mute", by: self.name });
          }
        } else {
          this.toId(msg.target, { type: "force-mute", by: self.name });
        }
        break;
      }
      // Host-only: remove a participant.
      case "host-remove": {
        if (!isHost) break;
        this.toId(msg.target, { type: "removed", by: self.name });
        break;
      }
    }
  }

  async webSocketClose(ws) {
    const self = this.meta(ws);
    this.broadcast({ type: "peer-leave", id: self.connId }, self.connId);
    // Host may have changed; tell everyone who holds it now.
    const host = this.hostId();
    if (host) this.broadcast({ type: "host", id: host });
  }

  async webSocketError(ws) {
    const self = this.meta(ws);
    this.broadcast({ type: "peer-leave", id: self.connId }, self.connId);
  }
}
