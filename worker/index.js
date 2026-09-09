// Cloudflare Worker entrypoint.
// - Serves the static SPA (via the ASSETS binding).
// - /api/auth/*  : register / login / me (email + password, JWT sessions).
// - /api/room/:id/ws : WebSocket to the room Durable Object (requires a valid token).
// - /api/config  : ICE servers + recording upload URL for the browser.

export { RoomDurableObject } from "./room.js";
export { AuthDurableObject } from "./auth.js";
import { issueToken, readToken } from "./auth.js";

const ROOM_WS = /^\/api\/room\/([A-Za-z0-9_-]{1,64})\/ws$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.AUTH_SECRET || "dev-secret-change-me";

    // ---- Auth -----------------------------------------------------------
    if (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/login") {
      const res = await authStub(env).fetch(request);
      if (!res.ok) return res; // error passthrough (JSON body preserved)
      const user = await res.json();
      const token = await issueToken(user, secret);
      return Response.json({ ...user, token });
    }
    if (url.pathname === "/api/auth/me") {
      const payload = await readToken(bearer(request), secret);
      if (!payload) return Response.json({ error: "Not authenticated" }, { status: 401 });
      return Response.json({ email: payload.email, name: payload.name, guest: !!payload.guest });
    }
    // Guest access: invited people can join without creating an account.
    if (url.pathname === "/api/auth/guest") {
      const body = await request.json().catch(() => ({}));
      const name = (body.name || "Guest").toString().trim().slice(0, 40) || "Guest";
      const token = await issueToken({ email: "guest:" + crypto.randomUUID(), name, guest: true }, secret);
      return Response.json({ email: "", name, guest: true, token });
    }

    // ---- Scheduled meetings (auth required, no guests) -----------------
    if (url.pathname === "/api/meetings") {
      const payload = await readToken(bearer(request), secret);
      if (!payload || payload.guest || !payload.email) return Response.json({ error: "Sign in to schedule meetings." }, { status: 401 });

      if (request.method === "GET") {
        const res = await authStub(env).fetch(new Request("https://do/sched-list", {
          method: "POST", body: JSON.stringify({ email: payload.email }),
        }));
        return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
      }
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const room = (body.room || "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || ("mtg-" + crypto.randomUUID().slice(0, 8));
        // "open" lets anyone with the link walk straight in; "approval" holds
        // them in the waiting room until the host admits them.
        const access = body.access === "open" ? "open" : "approval";
        const meeting = {
          id: crypto.randomUUID().slice(0, 12),
          title: String(body.title || "Meeting").slice(0, 120),
          when: String(body.when || ""),
          room,
          access,
          ownerEmail: payload.email,
          ownerName: payload.name,
          createdAt: Date.now(),
        };
        // Make the scheduler the owner/host of that room, and apply the
        // access mode they picked when creating it.
        try {
          const rstub = env.ROOMS.get(env.ROOMS.idFromName(room));
          await rstub.fetch(new Request("https://do/set-owner", { method: "POST", headers: { "X-Internal": "set-owner" }, body: JSON.stringify({ email: payload.email, access }) }));
        } catch {}
        const res = await authStub(env).fetch(new Request("https://do/sched-add", {
          method: "POST", body: JSON.stringify({ email: payload.email, meeting }),
        }));
        return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname.startsWith("/api/meetings/") && request.method === "DELETE") {
      const payload = await readToken(bearer(request), secret);
      if (!payload || payload.guest) return Response.json({ error: "Not authenticated" }, { status: 401 });
      const id = url.pathname.split("/").pop();
      const res = await authStub(env).fetch(new Request("https://do/sched-del", {
        method: "POST", body: JSON.stringify({ email: payload.email, id }),
      }));
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
    }

    // ---- Public config --------------------------------------------------
    if (url.pathname === "/api/config") {
      return Response.json({
        recordingUploadUrl: env.RECORDING_UPLOAD_URL || "",
        iceServers: buildIceServers(env),
      });
    }

    // ---- Room WebSocket (auth required) --------------------------------
    const match = url.pathname.match(ROOM_WS);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket Upgrade request.", { status: 426 });
      }
      const payload = await readToken(url.searchParams.get("token"), secret);
      if (!payload) return new Response("Unauthorized", { status: 401 });

      // Trust the display name from the verified token, not the query string.
      const roomId = match[1];
      const fwd = new URL(request.url);
      fwd.searchParams.set("name", payload.name);
      fwd.searchParams.set("email", payload.email || "");
      if (payload.guest) fwd.searchParams.set("guest", "1");
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(new Request(fwd, request));
    }

    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

    // Static single-page app.
    return env.ASSETS.fetch(request);
  },
};

function authStub(env) {
  const id = env.AUTH.idFromName("global");
  return env.AUTH.get(id);
}
function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function buildIceServers(env) {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  // Custom TURN (from env) takes priority when configured.
  const turnUrls = (env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: env.TURN_USERNAME || undefined,
      credential: env.TURN_CREDENTIAL || undefined,
    });
  } else {
    // Free public TURN relay (Open Relay) so people on different networks /
    // behind strict NATs can still connect out of the box. For heavy use,
    // set your own TURN via the TURN_* variables (e.g. Cloudflare Realtime TURN).
    const openRelay = ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"];
    servers.push({ urls: openRelay, username: "openrelayproject", credential: "openrelayproject" });
  }
  return servers;
}
