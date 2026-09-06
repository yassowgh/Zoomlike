// App orchestrator: lobby -> room, media, signaling, mesh, whiteboard, chat,
// recording. Vanilla ES modules, no build step.

import { Signaling } from "./signaling.js";
import { Whiteboard } from "./whiteboard.js";
import { Mesh } from "./rtc.js";
import { Recorder } from "./recorder.js";

const $ = (id) => document.getElementById(id);
const el = {
  lobby: $("lobby"), room: $("room"),
  nameInput: $("nameInput"), roomInput: $("roomInput"),
  randomRoomBtn: $("randomRoomBtn"), joinBtn: $("joinBtn"),
  optCam: $("optCam"), optMic: $("optMic"), lobbyHint: $("lobbyHint"),
  roomTitle: $("roomTitle"), copyLinkBtn: $("copyLinkBtn"),
  connState: $("connState"), galleryBtn: $("galleryBtn"),
  bgBtn: $("bgBtn"), bgMenu: $("bgMenu"),
  confirmLeave: $("confirmLeave"), confirmCancel: $("confirmCancel"), confirmLeaveBtn: $("confirmLeaveBtn"),
  guestBox: $("guestBox"), guestRoom: $("guestRoom"), guestName: $("guestName"), guestJoin: $("guestJoin"),
  board: $("board"), overlay: $("overlay"), boardWrap: $("boardWrap"),
  videos: $("videos"), toolbar: $("toolbar"),
  colorPick: $("colorPick"), sizePick: $("sizePick"),
  undoBtn: $("undoBtn"), clearBtn: $("clearBtn"),
  micBtn: $("micBtn"), camBtn: $("camBtn"), shareBtn: $("shareBtn"),
  recBtn: $("recBtn"), chatBtn: $("chatBtn"), leaveBtn: $("leaveBtn"),
  chat: $("chat"), chatLog: $("chatLog"), chatForm: $("chatForm"),
  chatInput: $("chatInput"), chatClose: $("chatClose"), toast: $("toast"),
  // auth
  auth: $("auth"), authForm: $("authForm"), authName: $("authName"),
  authEmail: $("authEmail"), authPassword: $("authPassword"), authSubmit: $("authSubmit"),
  authHint: $("authHint"), authTagline: $("authTagline"), nameField: $("nameField"),
  tabLogin: $("tabLogin"), tabRegister: $("tabRegister"),
  whoami: $("whoami"), logoutBtn: $("logoutBtn"),
};

const state = {
  name: "", email: "", token: "", roomId: "", config: null,
  sig: null, mesh: null, board: null, recorder: null,
  localStream: null, camTrack: null, screenTrack: null,
  peerNames: new Map(), tiles: new Map(),
  micOn: true, camOn: true, sharing: false,
};

// ---------------------------------------------------------------- lobby
function randomRoom() {
  const words = ["blue", "swift", "calm", "lunar", "maple", "delta", "nova", "echo", "amber", "pixel"];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}-${w()}-${Math.floor(100 + Math.random() * 900)}`;
}

function roomFromUrl() {
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,64})/);
  if (m) return m[1];
  return new URLSearchParams(location.search).get("room") || "";
}

// ------------------------------------------------------------------ auth
async function initAuth() {
  wireAuthForm();
  const token = localStorage.getItem("zl_token") || "";
  if (token) {
    try {
      const r = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
      if (r.ok) { const me = await r.json(); return enterLobby({ ...me, token }); }
    } catch {}
    localStorage.removeItem("zl_token");
  }
  showAuth();
}

function showAuth() {
  el.auth.hidden = false; el.lobby.hidden = true; el.room.hidden = true;
  showGuestOption();
  el.authEmail.focus();
}

let authMode = "login";
function wireAuthForm() {
  const setMode = (mode) => {
    authMode = mode;
    const reg = mode === "register";
    el.tabLogin.classList.toggle("active", !reg);
    el.tabRegister.classList.toggle("active", reg);
    el.nameField.hidden = !reg;
    el.authName.required = reg;
    el.authSubmit.textContent = reg ? "Create account" : "Log in";
    el.authTagline.textContent = reg ? "Create an account to start meeting." : "Log in to start meeting.";
    el.authPassword.autocomplete = reg ? "new-password" : "current-password";
    el.authHint.textContent = "";
  };
  el.tabLogin.onclick = () => setMode("login");
  el.tabRegister.onclick = () => setMode("register");

  el.authForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    const name = el.authName.value.trim();
    if (!email || !password) return;
    el.authSubmit.disabled = true;
    el.authHint.textContent = authMode === "register" ? "Creating account…" : "Logging in…";
    try {
      const r = await fetch("/api/auth/" + authMode, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await r.json();
      if (!r.ok) { el.authHint.textContent = data.error || "Something went wrong."; return; }
      localStorage.setItem("zl_token", data.token);
      enterLobby(data);
    } catch {
      el.authHint.textContent = "Network error. Please try again.";
    } finally {
      el.authSubmit.disabled = false;
    }
  };

  // Guest join (invited people don't have to register).
  el.guestJoin.onclick = async () => {
    const name = (el.guestName.value || "Guest").trim().slice(0, 40) || "Guest";
    el.guestJoin.disabled = true;
    el.authHint.textContent = "Joining…";
    try {
      const r = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (!r.ok) { el.authHint.textContent = data.error || "Could not join."; return; }
      enterLobby(data); // guests are not persisted to localStorage
    } catch {
      el.authHint.textContent = "Network error. Please try again.";
    } finally {
      el.guestJoin.disabled = false;
    }
  };
}

function showGuestOption() {
  const room = roomFromUrl();
  if (room) {
    el.guestBox.hidden = false;
    el.guestRoom.textContent = room;
    el.authTagline.textContent = "Log in, register, or join as a guest.";
  }
}

function enterLobby(account) {
  state.name = account.name; state.email = account.email; state.token = account.token;
  el.whoami.textContent = account.name;
  el.nameInput.value = account.name;
  el.auth.hidden = true; el.lobby.hidden = false; el.room.hidden = true;
  initLobby();
}

function logout() {
  localStorage.removeItem("zl_token");
  state.token = ""; state.name = ""; state.email = "";
  location.href = "/";
}

function applyBackground(name) {
  el.boardWrap.dataset.bg = name;
  localStorage.setItem("zl_bg", name);
}

// ----------------------------------------------------------------- lobby
let lobbyWired = false;
function initLobby() {
  const urlRoom = roomFromUrl();
  el.roomInput.value = urlRoom || randomRoom();
  if (!lobbyWired) {
    lobbyWired = true;
    el.randomRoomBtn.onclick = () => (el.roomInput.value = randomRoom());
    el.joinBtn.onclick = join;
    el.logoutBtn.onclick = logout;
    el.roomInput.addEventListener("keydown", (e) => e.key === "Enter" && join());
  }
  if (urlRoom) join();
}

// ----------------------------------------------------------------- join
async function join() {
  const name = (el.nameInput.value || "Guest").trim().slice(0, 40) || "Guest";
  const roomId = (el.roomInput.value || "").trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
  if (!roomId) { el.lobbyHint.textContent = "Please enter a room name."; return; }

  state.name = name; state.roomId = roomId;
  state.micOn = el.optMic.checked; state.camOn = el.optCam.checked;
  localStorage.setItem("zl_name", name);

  el.joinBtn.disabled = true;
  el.lobbyHint.textContent = "Getting camera & microphone…";

  await setupMedia();

  // Load runtime config (ICE servers, recording upload URL).
  try { state.config = await (await fetch("/api/config")).json(); }
  catch { state.config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], recordingUploadUrl: "" }; }

  history.replaceState(null, "", `/room/${roomId}`);
  el.lobby.hidden = true; el.room.hidden = false;
  el.roomTitle.textContent = roomId;

  setupBoard();
  setupControls();
  connect();
}

async function setupMedia() {
  const want = { audio: state.micOn, video: state.camOn };
  if (!want.audio && !want.video) { state.localStream = new MediaStream(); return; }
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(want);
  } catch (err) {
    console.warn("getUserMedia failed", err);
    try { state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); state.camOn = false; }
    catch { state.localStream = new MediaStream(); state.micOn = state.camOn = false; }
  }
  state.camTrack = state.localStream.getVideoTracks()[0] || null;
  applyTrackState();
}

function applyTrackState() {
  const a = state.localStream.getAudioTracks()[0];
  const v = state.localStream.getVideoTracks()[0];
  if (a) a.enabled = state.micOn;
  if (v) v.enabled = state.camOn;
  el.micBtn.classList.toggle("off", !state.micOn);
  el.camBtn.classList.toggle("off", !state.camOn);
  el.micBtn.textContent = state.micOn ? "🎙️" : "🔇";
  el.camBtn.textContent = state.camOn ? "📷" : "🚫";
}

// ----------------------------------------------------------- whiteboard
function setupBoard() {
  const wb = new Whiteboard(el.board, el.overlay, el.boardWrap);
  state.board = wb;
  wb.setColor(el.colorPick.value);
  wb.setSize(el.sizePick.value);

  wb.onShape = (shape) => state.sig?.send({ type: "draw", shape });
  wb.onErase = (id) => state.sig?.send({ type: "erase", id });
  const sendCursor = throttle((x, y) => state.sig?.send({ type: "cursor", x, y }), 60);
  wb.onCursor = sendCursor;

  el.toolbar.querySelectorAll(".tool[data-tool]").forEach((btn) => {
    btn.onclick = () => {
      el.toolbar.querySelectorAll(".tool[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      wb.setTool(btn.dataset.tool);
    };
  });
  el.colorPick.oninput = () => wb.setColor(el.colorPick.value);
  el.sizePick.oninput = () => wb.setSize(el.sizePick.value);
  el.undoBtn.onclick = () => wb.undoMine();
  el.clearBtn.onclick = () => {
    if (confirm("Clear the whiteboard for everyone?")) { wb.clearAll(); state.sig?.send({ type: "clear" }); }
  };
}

// ------------------------------------------------------------- controls
function setupControls() {
  state.recorder = new Recorder(state.config?.recordingUploadUrl || "");

  el.micBtn.onclick = () => toggleMic();
  el.camBtn.onclick = () => toggleCam();
  el.shareBtn.onclick = () => toggleShare();
  el.recBtn.onclick = () => toggleRecord();

  // Exit with confirmation.
  el.leaveBtn.onclick = () => { el.confirmLeave.hidden = false; };
  el.confirmCancel.onclick = () => { el.confirmLeave.hidden = true; };
  el.confirmLeaveBtn.onclick = () => leave();

  // Gallery <-> whiteboard view.
  el.galleryBtn.onclick = () => {
    const gallery = el.room.classList.toggle("gallery");
    el.galleryBtn.textContent = gallery ? "🖊️ Whiteboard" : "🔳 Gallery";
  };

  // Board background picker.
  applyBackground(localStorage.getItem("zl_bg") || "dark");
  el.bgBtn.onclick = (e) => { e.stopPropagation(); el.bgMenu.hidden = !el.bgMenu.hidden; };
  el.bgMenu.querySelectorAll(".bg-swatch").forEach((b) => {
    b.onclick = () => { applyBackground(b.dataset.bg); el.bgMenu.hidden = true; };
  });
  document.addEventListener("click", (e) => {
    if (!el.bgMenu.hidden && !el.bgMenu.contains(e.target) && e.target !== el.bgBtn) el.bgMenu.hidden = true;
  });

  // Keyboard: Ctrl/Cmd+Z = undo my last stroke.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.matches("input, textarea")) {
      e.preventDefault();
      state.board?.undoMine();
    }
  });

  el.copyLinkBtn.onclick = async () => {
    const url = `${location.origin}/room/${state.roomId}`;
    try { await navigator.clipboard.writeText(url); toast("Invite link copied"); }
    catch { prompt("Copy this invite link:", url); }
  };

  el.chatBtn.onclick = () => { el.chat.hidden = !el.chat.hidden; if (!el.chat.hidden) el.chatInput.focus(); };
  el.chatClose.onclick = () => (el.chat.hidden = true);
  el.chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    state.sig?.send({ type: "chat", text });
    addChat(state.name, text, true);
    el.chatInput.value = "";
  };

  addTile("self", "You", state.localStream, true);
}

async function toggleMic() {
  let a = state.localStream.getAudioTracks()[0];
  if (!a) { // acquire mic on demand
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      a = s.getAudioTracks()[0]; state.localStream.addTrack(a);
      state.mesh?.peers.forEach(({ pc }) => pc.addTrack(a, state.localStream));
    } catch { toast("Microphone unavailable"); return; }
  }
  state.micOn = !state.micOn; applyTrackState();
}

async function toggleCam() {
  let v = state.localStream.getVideoTracks()[0];
  if (!v) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      v = s.getVideoTracks()[0]; state.camTrack = v; state.localStream.addTrack(v);
      state.mesh?.peers.forEach(({ pc }) => pc.addTrack(v, state.localStream));
      refreshSelfTile();
    } catch { toast("Camera unavailable"); return; }
  }
  state.camOn = !state.camOn; applyTrackState();
}

async function toggleShare() {
  if (state.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.screenTrack = s.getVideoTracks()[0];
    state.sharing = true;
    el.shareBtn.classList.add("on");
    state.mesh?.replaceVideoTrack(state.screenTrack);
    refreshSelfTile(new MediaStream([state.screenTrack]));
    state.screenTrack.onended = () => stopShare();
  } catch { /* user cancelled */ }
}

function stopShare() {
  if (!state.sharing) return;
  state.sharing = false;
  el.shareBtn.classList.remove("on");
  try { state.screenTrack.stop(); } catch {}
  state.screenTrack = null;
  const cam = state.camTrack && state.camTrack.readyState === "live" ? state.camTrack : null;
  state.mesh?.replaceVideoTrack(cam);
  refreshSelfTile();
}

async function toggleRecord() {
  const r = state.recorder;
  if (!r.recording) {
    const audio = [state.localStream, ...[...state.tiles.values()].map((t) => t.stream)].filter(Boolean);
    r.start(el.board, audio);
    el.recBtn.classList.add("rec-on");
    el.connState.classList.add("rec"); el.connState.textContent = "● recording";
    toast("Recording started");
  } else {
    el.recBtn.classList.remove("rec-on");
    el.connState.classList.remove("rec");
    el.connState.textContent = "connected"; el.connState.classList.add("ok");
    const res = await r.stop(state.roomId);
    toast(res?.uploaded ? "Recording uploaded to your server" : "Recording saved (downloaded)");
  }
}

function leave() {
  try { state.recorder?.recording && state.recorder.stop(state.roomId); } catch {}
  state.sig?.close();
  state.mesh?.closeAll();
  state.localStream?.getTracks().forEach((t) => t.stop());
  location.href = "/";
}

// ------------------------------------------------------------ signaling
function connect() {
  const sig = new Signaling(state.roomId, state.name, state.token);
  state.sig = sig;

  const mesh = new Mesh({
    iceServers: state.config?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
    send: (to, data) => sig.send({ type: "signal", to, data }),
    onStream: (peerId, name, stream) => addTile(peerId, state.peerNames.get(peerId) || name, stream),
    onLeave: (peerId) => { removeTile(peerId); state.board?.removeCursor(peerId); },
  });
  mesh.setLocalStream(state.localStream);
  state.mesh = mesh;

  sig.addEventListener("open", () => { el.connState.textContent = "connected"; el.connState.classList.add("ok"); });
  sig.addEventListener("close", () => { el.connState.textContent = "reconnecting…"; el.connState.classList.remove("ok"); });

  sig.addEventListener("welcome", (e) => {
    const { self, peers, board } = e.detail;
    mesh.setSelf(self);
    state.board.loadShapes(board);
    for (const p of peers) { state.peerNames.set(p.id, p.name); mesh.addPeer(p.id, p.name); }
  });

  sig.addEventListener("peer-join", (e) => {
    const { id, name } = e.detail;
    state.peerNames.set(id, name);
    mesh.addPeer(id, name);
    toast(`${name} joined`);
  });

  sig.addEventListener("peer-leave", (e) => {
    const name = state.peerNames.get(e.detail.id);
    mesh.removePeer(e.detail.id);
    if (name) toast(`${name} left`);
  });

  sig.addEventListener("signal", (e) => mesh.handleSignal(e.detail.from, e.detail.name, e.detail.data));
  sig.addEventListener("draw", (e) => state.board.addRemoteShape(e.detail.shape));
  sig.addEventListener("erase", (e) => state.board.removeShape(e.detail.id));
  sig.addEventListener("clear", () => state.board.clearAll());
  sig.addEventListener("cursor", (e) => {
    const { id, name, x, y } = e.detail;
    state.board.showCursor(id, name, x, y, colorFor(id));
  });
  sig.addEventListener("chat", (e) => addChat(e.detail.name, e.detail.text, false));

  sig.connect();
}

// --------------------------------------------------------------- tiles
function addTile(id, name, stream, isSelf = false) {
  let tile = state.tiles.get(id);
  if (!tile) {
    const div = document.createElement("div");
    div.className = "tile" + (isSelf ? " self" : "");
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true; if (isSelf) v.muted = true;
    const label = document.createElement("span");
    label.className = "label"; label.textContent = name + (isSelf ? " (you)" : "");
    div.append(v, label);
    el.videos.appendChild(div);
    tile = { div, video: v, label, stream };
    state.tiles.set(id, tile);
  }
  tile.stream = stream;
  tile.video.srcObject = stream;
  tile.label.textContent = name + (isSelf ? " (you)" : "");
  tile.video.play?.().catch(() => {});
  return tile;
}
function removeTile(id) {
  const t = state.tiles.get(id);
  if (t) { t.div.remove(); state.tiles.delete(id); }
}
function refreshSelfTile(stream) {
  const t = state.tiles.get("self");
  if (t) { t.video.srcObject = stream || state.localStream; }
}

// ---------------------------------------------------------------- chat
function addChat(who, text, me) {
  const div = document.createElement("div");
  div.className = "chat-msg" + (me ? " me" : "");
  div.innerHTML = `<div class="who"></div><div class="body"></div>`;
  div.querySelector(".who").textContent = me ? "You" : who;
  div.querySelector(".body").textContent = text;
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (me === false && el.chat.hidden) toast(`💬 ${who}: ${text.slice(0, 40)}`);
}

// -------------------------------------------------------------- helpers
let toastT;
function toast(msg) {
  el.toast.textContent = msg; el.toast.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (el.toast.hidden = true), 2600);
}
function throttle(fn, ms) {
  let last = 0, timer = null, lastArgs;
  return (...args) => {
    lastArgs = args; const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...lastArgs); }, ms - (now - last)); }
  };
}
function colorFor(id) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 80%, 60%)`;
}

initAuth();
