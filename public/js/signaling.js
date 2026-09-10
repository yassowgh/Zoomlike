// Thin WebSocket wrapper to the room's Durable Object.
// Emits parsed messages by `type`, and works hard to stay connected.
//
// STAYING CONNECTED is most of this file. A meeting socket sits idle for long
// stretches, and a laptop lid or a minimised phone browser suspends the tab.
// Both produce the same nasty failure: the connection is dead but the browser
// never fires `close`, so readyState still says OPEN and nothing reconnects.
// Meanwhile the room has already dropped you from its roster — you can still
// hear everyone, because that audio is peer-to-peer and does not go through
// here, but nobody can see that you are in the call.
//
// So: a heartbeat proves the socket is alive, silence past a deadline is
// treated as death, and coming back to the foreground reconnects at once
// instead of waiting out a backoff.

const PING_MS = 15000;    // how often we prove the socket is alive
const DEAD_MS = 40000;    // silence longer than this means it is not
const MAX_BACKOFF = 15000;

export class Signaling extends EventTarget {
  constructor(roomId, name, token, skip, helloExtra) {
    super();
    this.roomId = roomId;
    this.name = name;
    this.token = token || "";
    this.skip = skip ? "1" : "";
    // Extra fields sent with the opening `hello` (e.g. the access mode chosen
    // when this join is the one that creates the room).
    this.helloExtra = helloExtra || {};
    this.ws = null;
    this.selfId = null;
    this.closed = false;
    this.backoff = 1000;
    this.lastSeen = 0;
    this._timer = 0;
    this._watch = 0;
    this._retry = 0;
    // A stable id for this browser tab in this room. The room uses it to
    // recognise a reconnect as the same person rather than a second arrival,
    // so a dropped socket does not leave a ghost in everyone's roster.
    this.cid = tabId(roomId);
    this._wake = () => { if (!document.hidden) this.ensureConnected(); };
  }

  connect() {
    if (this.closed) return;
    clearTimeout(this._retry); this._retry = 0;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ name: this.name, token: this.token, cid: this.cid });
    if (this.skip) q.set("skip", "1");
    const ws = new WebSocket(`${proto}://${location.host}/api/room/${encodeURIComponent(this.roomId)}/ws?${q}`);
    this.ws = ws;
    this.lastSeen = Date.now();

    ws.addEventListener("open", () => {
      this.backoff = 1000;
      this.lastSeen = Date.now();
      this.send({ type: "hello", ...this.helloExtra });
      this.dispatchEvent(new Event("open"));
    });

    ws.addEventListener("message", (ev) => {
      // Any traffic at all, the heartbeat's "pong" included, proves the
      // connection is still there.
      this.lastSeen = Date.now();
      if (ev.data === "pong") return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "welcome") this.selfId = msg.self;
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });

    ws.addEventListener("close", () => {
      if (ws !== this.ws) return;      // a socket we already replaced
      this.dispatchEvent(new Event("close"));
      this.retry();
    });

    ws.addEventListener("error", () => { try { ws.close(); } catch {} });

    this.startHeartbeat();
    addEventListener("visibilitychange", this._wake);
    addEventListener("online", this._wake);
    addEventListener("pageshow", this._wake);
  }

  // A dead socket that never fired `close` is the whole reason this exists.
  startHeartbeat() {
    clearInterval(this._timer);
    clearInterval(this._watch);

    // The browser flips readyState the moment it knows the socket is going or
    // gone, even when it never gets round to firing `close` — a half-closed
    // socket can sit in CLOSING indefinitely waiting for a reply that is not
    // coming. Noticing that costs nothing and recovers in seconds instead of
    // waiting out the next ping.
    this._watch = setInterval(() => {
      if (this.closed) return;
      const ws = this.ws;
      if (!ws) return this.ensureConnected();
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        this.ws = null;                       // its own close handler now no-ops
        this.dispatchEvent(new Event("close"));
        this.connect();
      }
    }, 2000);

    this._timer = setInterval(() => {
      if (this.closed) return;
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return this.ensureConnected();
      if (Date.now() - this.lastSeen > DEAD_MS) {
        // Silent past the deadline: stop believing this socket and start over.
        this.ws = null;
        try { ws.close(); } catch {}
        this.dispatchEvent(new Event("close"));
        return this.connect();
      }
      try { ws.send("ping"); } catch { this.ensureConnected(); }
    }, PING_MS);
  }

  // Called when the tab comes back to the foreground or the network returns:
  // reconnect now rather than sitting out whatever backoff was pending.
  ensureConnected() {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.lastSeen = Date.now();
      try { this.ws.send("ping"); } catch {}
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    this.backoff = 1000;
    this.connect();
  }

  retry() {
    if (this.closed || this._retry) return;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
    this._retry = setTimeout(() => { this._retry = 0; this.connect(); }, this.backoff);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closed = true;
    clearInterval(this._timer);
    clearInterval(this._watch);
    clearTimeout(this._retry);
    removeEventListener("visibilitychange", this._wake);
    removeEventListener("online", this._wake);
    removeEventListener("pageshow", this._wake);
    if (this.ws) this.ws.close();
  }
}

// One id per tab per room, kept in sessionStorage so a reload is still
// recognisably the same person and a second tab is honestly a second person.
function tabId(roomId) {
  const key = "zl_cid_" + roomId;
  try {
    let v = sessionStorage.getItem(key);
    if (!v) { v = rand(); sessionStorage.setItem(key, v); }
    return v;
  } catch { return rand(); }
}
function rand() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
