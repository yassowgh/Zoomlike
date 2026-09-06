// Cloudflare-native authentication: email + password, no external service.
//
// - AuthDurableObject stores accounts (one global instance) with PBKDF2-hashed
//   passwords in Durable Object storage.
// - Sessions are stateless HS256 JWTs signed with env.AUTH_SECRET.
//
// Everything here runs on the free Workers plan.

const ITERATIONS = 100_000;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    return json({ error: "Not found" }, 404);
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
    const user = await this.state.storage.get("user:" + email);
    if (!user) return json({ error: "No account found for this email." }, 401);
    const ok = await verifyPassword(password || "", user.salt, user.hash);
    if (!ok) return json({ error: "Incorrect password." }, 401);
    return json({ email: user.email, name: user.name });
  }
}

// ---- Worker-side helpers (exported for index.js) ------------------------

export async function issueToken(user, secret) {
  const payload = { email: user.email, name: user.name, exp: Date.now() + TOKEN_TTL_MS };
  if (user.guest) payload.guest = true;
  return signJWT(payload, secret);
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
