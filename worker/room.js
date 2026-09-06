// RoomDurableObject: one instance per meeting room.
//
// Responsibilities:
//   1. WebRTC signaling relay  — passes offer/answer/ICE between peers so they
//      can establish direct peer-to-peer media connections (mesh topology).
//   2. Whiteboard broadcast    — fans out every draw op to all other peers.
//   3. Whiteboard persistence  — stores each shape so late-joiners see the
//      board as it currently is.
//
// Uses the hibernatable WebSocket API: the DO can be evicted from memory
// between messages without dropping connections, which keeps idle rooms free.

const MAX_PEERS = 12; // mesh gets expensive beyond this; guard rail.

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_PEERS) {
      return new Response("Room is full.", { status: 503 });
    }

    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "Guest").slice(0, 40);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const connId = crypto.randomUUID();
    // Attachment survives hibernation, so we can identify the socket later.
    server.serializeAttachment({ connId, name });
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- helpers ------------------------------------------------------------

  meta(ws) {
    return ws.deserializeAttachment() || {};
  }

  peers() {
    return this.state.getWebSockets().map((ws) => {
      const m = this.meta(ws);
      return { ws, id: m.connId, name: m.name };
    });
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* socket closing */
    }
  }

  broadcast(obj, exceptId) {
    const data = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (exceptId && this.meta(ws).connId === exceptId) continue;
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  async loadBoard() {
    const map = await this.state.storage.list({ prefix: "shape:" });
    return [...map.values()];
  }

  // --- WebSocket lifecycle ------------------------------------------------

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const self = this.meta(ws);

    switch (msg.type) {
      // First message from a freshly connected client.
      case "hello": {
        const others = this.peers()
          .filter((p) => p.id !== self.connId)
          .map((p) => ({ id: p.id, name: p.name }));
        const board = await this.loadBoard();
        this.send(ws, { type: "welcome", self: self.connId, peers: others, board });
        // Tell existing peers that a new participant arrived.
        this.broadcast({ type: "peer-join", id: self.connId, name: self.name }, self.connId);
        break;
      }

      // WebRTC signaling: relay to a single target peer.
      case "signal": {
        const target = this.peers().find((p) => p.id === msg.to);
        if (target) {
          this.send(target.ws, {
            type: "signal",
            from: self.connId,
            name: self.name,
            data: msg.data,
          });
        }
        break;
      }

      // Whiteboard: a new shape (pen stroke, rectangle, text, ...).
      case "draw": {
        if (msg.shape && msg.shape.id) {
          await this.state.storage.put("shape:" + msg.shape.id, msg.shape);
        }
        this.broadcast({ type: "draw", shape: msg.shape }, self.connId);
        break;
      }

      // Whiteboard: remove one shape (eraser / undo).
      case "erase": {
        if (msg.id) await this.state.storage.delete("shape:" + msg.id);
        this.broadcast({ type: "erase", id: msg.id }, self.connId);
        break;
      }

      // Whiteboard: wipe the board for everyone.
      case "clear": {
        const map = await this.state.storage.list({ prefix: "shape:" });
        await this.state.storage.delete([...map.keys()]);
        this.broadcast({ type: "clear" }, self.connId);
        break;
      }

      // Live cursor position (not persisted).
      case "cursor": {
        this.broadcast({ type: "cursor", id: self.connId, name: self.name, x: msg.x, y: msg.y }, self.connId);
        break;
      }

      // Rename / chat pass-through.
      case "chat": {
        this.broadcast({ type: "chat", id: self.connId, name: self.name, text: String(msg.text || "").slice(0, 2000) }, self.connId);
        break;
      }
    }
  }

  async webSocketClose(ws) {
    const self = this.meta(ws);
    this.broadcast({ type: "peer-leave", id: self.connId }, self.connId);
    // If the room is now empty, clear the persisted board after a grace period
    // is unnecessary here — we keep it so a reopened room resumes. Storage for
    // an idle DO costs nothing meaningful on the free tier.
  }

  async webSocketError(ws) {
    const self = this.meta(ws);
    this.broadcast({ type: "peer-leave", id: self.connId }, self.connId);
  }
}
