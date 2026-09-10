// Cloudflare-native authentication: email + password, no external service.
//
// - AuthDurableObject stores accounts (one global instance) with PBKDF2-hashed
//   passwords in Durable Object storage.
// - Sessions are stateless HS256 JWTs signed with env.AUTH_SECRET.
//
// Everything here runs on the free Workers plan.

const ITERATIONS = 100_000;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TTL_MS = 30 * 60 * 1000;          // password reset links last 30 minutes
const MAX_FAILS = 5;                          // wrong passwords before a lockout
const LOCK_MS = 5 * 60 * 1000;                // how long that lockout lasts

export class AuthDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    if (url.pathname.endsWith("/register")) return this.register(body);
    if (url.pathname.endsWith("/login")) return this.login(body);
    if (url.pathname.endsWith("/google-upsert")) return this.googleUpsert(body);
    if (url.pathname.endsWith("/forgot-create")) return this.forgotCreate(body);
    if (url.pathname.endsWith("/reset-apply")) return this.resetApply(body);
    if (url.pathname.endsWith("/sched-add")) return this.schedAdd(body);
    if (url.pathname.endsWith("/sched-list")) return this.schedList(body);
    if (url.pathname.endsWith("/sched-del")) return this.schedDel(body);
    return json({ error: "Not found" }, 404);
  }

  async schedAdd({ email, meeting }) {
    if (!email || !meeting || !meeting.id) return json({ error: "Bad request" }, 400);
    await this.state.storage.put(`sched:${email}:${meeting.id}`, meeting);
    return json(meeting);
  }
  async schedList({ email }) {
    const map = await this.state.storage.list({ prefix: `sched:${email}:` });
    const items = [...map.values()].sort((a, b) => String(a.when).localeCompare(String(b.when)));
    return json({ meetings: items });
  }
  async schedDel({ email, id }) {
    await this.state.storage.delete(`sched:${email}:${id}`);
    return json({ ok: true });
  }

  async register({ email, password, name }) {
    email = normEmail(email);
    if (!validEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
    if (!password || password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    if (await this.state.storage.get("user:" + email)) {
      return json({ error: "An account with this email already exists. Try logging in." }, 409);
    }
    const { salt, hash } = await hashPassword(password);
    const user = {
      email,
      name: (name || email.split("@")[0]).trim().slice(0, 40),
      salt,
      hash,
      createdAt: Date.now(),
    };
    await this.state.storage.put("user:" + email, user);
    return json({ email: user.email, name: user.name });
  }

  async login({ email, password }) {
    email = normEmail(email);

    // Too many wrong guesses recently? Say so, and don't check the password.
    const lock = await this.state.storage.get("fail:" + email);
    if (lock && lock.until && Date.now() < lock.until) {
      const mins = Math.max(1, Math.ceil((lock.until - Date.now()) / 60000));
      return json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, locked: true }, 429);
    }

    const user = await this.state.storage.get("user:" + email);
    // Deliberately the same message whether the address is unknown or the
    // password is wrong: telling them apart reveals who has an account.
    const wrong = () => json({ error: "Email or password is incorrect." }, 401);

    if (user && !user.hash) {
      // Signed up through Google and never set a password.
      return json({ error: "This account uses Google sign-in. Use \u201cContinue with Google\u201d, or reset your password to set one." }, 401);
    }
    const ok = user && await verifyPassword(password || "", user.salt, user.hash);
    if (!ok) {
      await this.noteFailure(email);
      return wrong();
    }
    await this.state.storage.delete("fail:" + email);
    return json({ email: user.email, name: user.name });
  }

  // Counts wrong passwords and locks the account for a while once there have
  // been too many. Note this is per email address, so someone who knows an
  // address can deliberately lock its owner out for five minutes.
  async noteFailure(email) {
    const rec = (await this.state.storage.get("fail:" + email)) || { count: 0, until: 0 };
    rec.count += 1;
    if (rec.count >= MAX_FAILS) { rec.until = Date.now() + LOCK_MS; rec.count = 0; }
    await this.state.storage.put("fail:" + email, rec);
  }

  // Sign-in through Google. Accounts are keyed by verified email address, so
  // using Google for an address that already has a password links the two
  // rather than creating a second account.
  async googleUpsert({ email, name, sub }) {
    email = normEmail(email);
    if (!validEmail(email)) return json({ error: "Google did not return a usable email address." }, 400);
    const existing = await this.state.storage.get("user:" + email);
    if (existing) {
      if (existing.googleSub !== sub) {
        await this.state.storage.put("user:" + email, { ...existing, googleSub: sub });
      }
      return json({ email: existing.email, name: existing.name });
    }
    const user = {
      email,
      name: (name || email.split("@")[0]).trim().slice(0, 40),
      googleSub: sub,
      createdAt: Date.now(),
    };
    await this.state.storage.put("user:" + email, user);
    return json({ email: user.email, name: user.name });
  }

  // Creates a single-use reset token. Only the SHA-256 of the token is stored,
  // so storage alone cannot be used to reset anyone's password.
  async forgotCreate({ email }) {
    email = normEmail(email);
    const user = await this.state.storage.get("user:" + email);
    // Deliberately no signal either way: the caller always sees the same shape.
    if (!user) return json({ ok: true, token: null, name: null });
    const token = bufToHex(crypto.getRandomValues(new Uint8Array(32)));
    await this.state.storage.put("reset:" + (await sha256Hex(token)), {
      email,
      exp: Date.now() + RESET_TTL_MS,
    });
    return json({ ok: true, token, name: user.name });
  }

  async resetApply({ token, password }) {
    if (!token) return json({ error: "This reset link is not valid." }, 400);
    if (!password || password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
    const key = "reset:" + (await sha256Hex(token));
    const rec = await this.state.storage.get(key);
    if (!rec) return json({ error: "This reset link has already been used or is not valid." }, 400);
    await this.state.storage.delete(key); // single use, whatever happens next
    if (Date.now() > rec.exp) return json({ error: "This reset link has expired. Please request a new one." }, 400);

    const user = await this.state.storage.get("user:" + rec.email);
    if (!user) return json({ error: "This account no longer exists." }, 400);
    const { salt, hash } = await hashPassword(password);
    await this.state.storage.put("user:" + rec.email, { ...user, salt, hash });
    await this.state.storage.delete("fail:" + rec.email); // a reset clears any lockout
    return json({ email: user.email, name: user.name });
  }
}

// ---- Worker-side helpers (exported for index.js) ------------------------

export async function issueToken(user, secret) {
  const payload = { email: user.email, name: user.name, exp: Date.now() + TOKEN_TTL_MS };
  if (user.guest) payload.guest = true;
  return signJWT(payload, secret);
}

// Short-lived signed blobs for the OAuth `state` parameter, so the callback can
// trust where it came from without keeping any server-side session.
export async function signState(payload, secret) {
  return signJWT({ ...payload, exp: Date.now() + 10 * 60 * 1000 }, secret);
}
export async function readState(value, secret) {
  const payload = await verifyJWT(value, secret);
  if (!payload || (payload.exp && Date.now() > payload.exp)) return null;
  return payload;
}

export async function readToken(token, secret) {
  if (!token) return null;
  const payload = await verifyJWT(token, secret);
  if (!payload || (payload.exp && Date.now() > payload.exp)) return null;
  return payload;
}

// ---- password hashing (PBKDF2 / SHA-256) --------------------------------

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { salt: bufToHex(salt), hash: bufToHex(new Uint8Array(bits)) };
}
async function verifyPassword(password, saltHex, hashHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, hashHex);
}

// ---- minimal HS256 JWT --------------------------------------------------

async function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = await hmac(data, secret);
  return `${data}.${sig}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = await hmac(data, secret);
  if (!timingSafeEqual(expected, parts[2])) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
}
async function hmac(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret || "dev-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

// ---- utils --------------------------------------------------------------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function normEmail(e) { return String(e || "").toLowerCase().trim(); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return bufToHex(new Uint8Array(digest));
}
function bufToHex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  return atob(str);
}
