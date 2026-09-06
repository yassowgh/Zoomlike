// Cloudflare Worker entrypoint.
// - Serves the static SPA (via the ASSETS binding).
// - Routes /api/room/:id/ws to the room's Durable Object (WebSocket).
// - Exposes /api/config so the browser can fetch ICE servers + upload URL.

export { RoomDurableObject } from "./room.js";

const ROOM_WS = /^\/api\/room\/([A-Za-z0-9_-]{1,64})\/ws$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Public runtime config for the browser.
    if (url.pathname === "/api/config") {
      return Response.json({
        recordingUploadUrl: env.RECORDING_UPLOAD_URL || "",
        iceServers: buildIceServers(env),
      });
    }

    // WebSocket upgrade -> route to the per-room Durable Object.
    const match = url.pathname.match(ROOM_WS);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket Upgrade request.", { status: 426 });
      }
      const roomId = match[1];
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    // Unknown /api/* -> 404 (don't leak into the SPA fallback).
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    // Everything else -> the static single-page app.
    return env.ASSETS.fetch(request);
  },
};

// Google's public STUN servers are free and enough for most peer-to-peer
// connections. TURN (relay) is optional and only needed behind strict NATs.
function buildIceServers(env) {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  const turnUrls = (env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: env.TURN_USERNAME || undefined,
      credential: env.TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}
