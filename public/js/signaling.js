// Thin WebSocket wrapper to the room's Durable Object.
// Emits parsed messages by `type` and auto-reconnects with backoff.

export class Signaling extends EventTarget {
  constructor(roomId, name) {
    super();
    this.roomId = roomId;
    this.name = name;
    this.ws = null;
    this.selfId = null;
    this.closed = false;
    this.backoff = 1000;
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/api/room/${encodeURIComponent(this.roomId)}/ws?name=${encodeURIComponent(this.name)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoff = 1000;
      this.send({ type: "hello" });
      this.dispatchEvent(new Event("open"));
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.selfId = msg.self;
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });

    ws.addEventListener("close", () => {
      this.dispatchEvent(new Event("close"));
      if (!this.closed) setTimeout(() => this.connect(), (this.backoff = Math.min(this.backoff * 2, 15000)));
    });

    ws.addEventListener("error", () => ws.close());
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closed = true;
    if (this.ws) this.ws.close();
  }
}
