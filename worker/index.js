// Cloudflare Worker entrypoint.
// - Serves the static SPA (via the ASSETS binding).
// - /api/auth/*  : register / login / me (email + password, JWT sessions).
// - /api/room/:id/ws : WebSocket to the room Durable Object (requires a valid token).
// - /api/config  : ICE servers + recording upload URL for the browser.

export { RoomDurableObject } from "./room.js";
export { AuthDurableObject } from "./auth.js";
import { issueToken, readToken, signState, readState } from "./auth.js";

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
      const name = (body.name || "").toString().trim().slice(0, 40);
      // Everyone in a meeting has to be identifiable, so a guest must give a
      // real name. "Guest" is not one — several of them are indistinguishable.
      if (name.length < 2 || /^guests?$/i.test(name)) {
        return Response.json({ error: "Please enter your name so people know who you are." }, { status: 400 });
      }
      const token = await issueToken({ email: "guest:" + crypto.randomUUID(), name, guest: true }, secret);
      return Response.json({ email: "", name, guest: true, token });
    }

    // ---- Sign in with Google -------------------------------------------
    // Standard OAuth 2.0 authorization-code flow. The id_token is fetched
    // server-to-server from Google over TLS using the client secret, so its
    // contents are trusted without a separate signature check.
    if (url.pathname === "/api/auth/google/start") {
      if (!googleConfigured(env)) return new Response("Google sign-in is not configured on this server.", { status: 501 });
      const state = await signState({ n: crypto.randomUUID(), to: safeReturnPath(url.searchParams.get("to")) }, secret);
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      auth.searchParams.set("redirect_uri", googleRedirectUri(url));
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", "openid email profile");
      auth.searchParams.set("state", state);
      auth.searchParams.set("prompt", "select_account");
      return Response.redirect(auth.toString(), 302);
    }
    if (url.pathname === "/api/auth/google/callback") {
      if (!googleConfigured(env)) return new Response("Google sign-in is not configured on this server.", { status: 501 });
      const back = (msg) => Response.redirect(new URL("/?autherror=" + encodeURIComponent(msg), url.origin).toString(), 302);
      if (url.searchParams.get("error")) return back("Google sign-in was cancelled.");
      const st = await readState(url.searchParams.get("state"), secret);
      if (!st) return back("That sign-in attempt expired. Please try again.");
      const code = url.searchParams.get("code");
      if (!code) return back("Google did not return an authorization code.");

      let profile;
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: googleRedirectUri(url),
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) throw new Error("token exchange failed: " + tokenRes.status);
        const tok = await tokenRes.json();
        profile = decodeJwtPayload(tok.id_token);
      } catch (err) {
        console.warn("google sign-in failed", err);
        return back("Could not complete Google sign-in. Please try again.");
      }
      if (!profile || !profile.email) return back("Google did not share an email address.");
      if (profile.email_verified === false) return back("That Google email address is not verified.");

      const res = await authStub(env).fetch(new Request("https://do/google-upsert", {
        method: "POST",
        body: JSON.stringify({ email: profile.email, name: profile.name, sub: profile.sub }),
      }));
      if (!res.ok) return back("Could not sign you in with that Google account.");
      const user = await res.json();
      const token = await issueToken(user, secret);
      // Hand the token back in the fragment so it never reaches a server log.
      const dest = new URL(st.to || "/", url.origin);
      dest.hash = "token=" + encodeURIComponent(token);
      return Response.redirect(dest.toString(), 302);
    }

    // ---- Forgot / reset password ---------------------------------------
    if (url.pathname === "/api/auth/forgot" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const res = await authStub(env).fetch(new Request("https://do/forgot-create", {
        method: "POST", body: JSON.stringify({ email: body.email }),
      }));
      const out = await res.json().catch(() => ({}));
      let delivered = false;
      // A missing account produces no token, and we still answer identically,
      // so this endpoint never reveals whether an address is registered.
      if (out.token) {
        const link = new URL("/?reset=" + encodeURIComponent(out.token), url.origin).toString();
        delivered = await sendResetEmail(env, String(body.email || ""), out.name || "", link);
      }
      return Response.json({ ok: true, configured: mailConfigured(env), delivered });
    }
    if (url.pathname === "/api/auth/reset" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const res = await authStub(env).fetch(new Request("https://do/reset-apply", {
        method: "POST", body: JSON.stringify({ token: body.token, password: body.password }),
      }));
      if (!res.ok) return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
      const user = await res.json();
      const token = await issueToken(user, secret);
      return Response.json({ ...user, token });
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
        // Let the UI hide options this deployment cannot actually perform.
        googleAuth: googleConfigured(env),
        passwordReset: mailConfigured(env),
        // Whether a real relay is configured. Without one, anybody behind a
        // strict NAT (most mobile networks) cannot connect at all.
        turn: !!(env.TURN_URLS || "").trim(),
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

function googleConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
function googleRedirectUri(url) {
  return new URL("/api/auth/google/callback", url.origin).toString();
}
// Only ever return to a path on this site, never to an absolute URL an
// attacker could put in the query string.
function safeReturnPath(to) {
  if (!to || typeof to !== "string") return "/";
  if (!to.startsWith("/") || to.startsWith("//")) return "/";
  return to.slice(0, 200);
}
function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt).split(".")[1];
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)); // names can be non-ASCII
  } catch { return null; }
}

function mailConfigured(env) {
  return !!(env.RESEND_API_KEY && env.MAIL_FROM) || !!env.MAIL_WEBHOOK_URL;
}

// Sends the reset link with whichever provider is configured. Returns whether
// it actually went out, so the UI can be honest when nothing is set up.
async function sendResetEmail(env, to, name, link) {
  const subject = "Reset your Zoomlike password";
  const text = `Hi ${name || "there"},\n\nUse this link to set a new password. It expires in 30 minutes and can only be used once.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`;
  try {
    if (env.RESEND_API_KEY && env.MAIL_FROM) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
      });
      if (!r.ok) throw new Error("resend " + r.status);
      return true;
    }
    if (env.MAIL_WEBHOOK_URL) {
      const r = await fetch(env.MAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, name, subject, text, link }),
      });
      if (!r.ok) throw new Error("webhook " + r.status);
      return true;
    }
  } catch (err) {
    console.warn("reset email not sent", err);
  }
  return false;
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
