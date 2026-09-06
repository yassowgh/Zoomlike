// App orchestrator: lobby -> room, media, signaling, mesh, whiteboard, chat,
// recording. Vanilla ES modules, no build step.

import { Signaling } from "./signaling.js";
import { Whiteboard } from "./whiteboard.js";
import { Mesh } from "./rtc.js";
import { Recorder } from "./recorder.js";
import { VirtualBg } from "./virtualbg.js";

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
  whoami: $("whoami"), logoutBtn: $("logoutBtn"), pwToggle: $("pwToggle"),
  // meeting features
  handBtn: $("handBtn"), reactBtn: $("reactBtn"), reactMenu: $("reactMenu"),
  recMenu: $("recMenu"), recServerOpt: $("recServerOpt"), reactionLayer: $("reactionLayer"),
  peopleBtn: $("peopleBtn"), people: $("people"), peopleClose: $("peopleClose"),
  peopleList: $("peopleList"), peopleCount: $("peopleCount"), muteAllBtn: $("muteAllBtn"),
  chatTo: $("chatTo"),
  // waiting room + host tools
  waitingScreen: $("waitingScreen"), waitRoom: $("waitRoom"), waitLeave: $("waitLeave"),
  waitingWrap: $("waitingWrap"), waitingList: $("waitingList"), hostTools: $("hostTools"),
  lowerHandsBtn: $("lowerHandsBtn"), waitingToggle: $("waitingToggle"), breakoutBtn: $("breakoutBtn"),
  // breakout
  breakout: $("breakout"), breakoutClose: $("breakoutClose"), brkCount: $("brkCount"),
  brkCreate: $("brkCreate"), brkPreview: $("brkPreview"), brkOpen: $("brkOpen"), brkCloseAll: $("brkCloseAll"),
  breakoutBanner: $("breakoutBanner"), returnMain: $("returnMain"),
  // virtual background
  bgVideoBtn: $("bgVideoBtn"), bgVideoMenu: $("bgVideoMenu"),
  // schedule
  schedSection: $("schedSection"), schedNewBtn: $("schedNewBtn"), schedList: $("schedList"),
  schedForm: $("schedForm"), schedTitle: $("schedTitle"), schedWhen: $("schedWhen"), schedCancel: $("schedCancel"),
};

const state = {
  name: "", email: "", token: "", roomId: "", config: null,
  sig: null, mesh: null, board: null, recorder: null,
  localStream: null, camTrack: null, screenTrack: null,
  peerNames: new Map(), tiles: new Map(),
  micOn: true, camOn: true, sharing: false,
  selfId: "", host: "", peers: new Map(), hand: false, recTarget: "computer",
  waiting: true, waitingList: new Map(), breakouts: [], vbg: null, vbgMode: "none",
  skip: false, mainRoom: "",
};
const isHost = () => state.selfId && state.selfId === state.host;

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
  // sessionStorage carries a guest/reload token across navigations (breakouts);
  // localStorage carries a registered user's persistent login.
  const token = sessionStorage.getItem("zl_token") || localStorage.getItem("zl_token") || "";
  if (token) {
    try {
      const r = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
      if (r.ok) { const me = await r.json(); return enterLobby({ ...me, token, guest: me.guest }); }
    } catch {}
    sessionStorage.removeItem("zl_token"); localStorage.removeItem("zl_token");
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

  el.pwToggle.onclick = () => {
    const show = el.authPassword.type === "password";
    el.authPassword.type = show ? "text" : "password";
    el.pwToggle.textContent = show ? "🙈" : "👁️";
  };

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
  state.name = account.name; state.email = account.email || ""; state.token = account.token;
  state.isGuest = !!account.guest || !state.email;
  sessionStorage.setItem("zl_token", account.token);
  el.whoami.textContent = account.name;
  el.nameInput.value = account.name;
  el.auth.hidden = true; el.lobby.hidden = false; el.room.hidden = true;
  // Scheduling is for registered users only.
  el.schedSection.hidden = state.isGuest;
  if (!state.isGuest) { wireSchedule(); loadSchedule(); }
  initLobby();
}

function logout() {
  localStorage.removeItem("zl_token"); sessionStorage.removeItem("zl_token");
  state.token = ""; state.name = ""; state.email = "";
  location.href = "/";
}

function applyBackground(name) {
  el.boardWrap.dataset.bg = name;
  localStorage.setItem("zl_bg", name);
}

// ------------------------------------------------------------- breakouts
function buildBreakouts() {
  const count = Math.max(1, Math.min(8, parseInt(el.brkCount.value, 10) || 2));
  const members = [...state.peers.keys()]; // everyone except the host (self)
  state.breakouts = Array.from({ length: count }, (_, i) => ({ room: `${state.roomId}-b${i + 1}`.slice(0, 60), name: `Room ${i + 1}`, members: [] }));
  members.forEach((id, i) => state.breakouts[i % count].members.push(id));
  el.brkPreview.innerHTML = "";
  for (const r of state.breakouts) {
    const div = document.createElement("div"); div.className = "brk-room";
    const names = r.members.map((id) => state.peers.get(id)?.name || "?").join(", ") || "(empty)";
    div.innerHTML = `<b></b><div class="m"></div>`;
    div.querySelector("b").textContent = r.name;
    div.querySelector(".m").textContent = names;
    el.brkPreview.appendChild(div);
  }
  el.brkOpen.disabled = members.length === 0;
  if (!members.length) toast("No other participants to assign yet");
}

// ------------------------------------------------------ virtual background
async function setVirtualBg(mode) {
  if (mode === "none") {
    state.vbgMode = "none";
    if (state.vbg) state.vbg.stop();
    state.vbg = null; state.vbgTrack = null;
    applyVideoOutput();
    toast("Virtual background off");
    return;
  }
  if (!state.camTrack || state.camTrack.readyState !== "live") {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      state.camTrack = s.getVideoTracks()[0];
      if (!state.localStream.getVideoTracks().length) {
        state.localStream.addTrack(state.camTrack);
        state.mesh?.peers.forEach(({ pc }) => pc.addTrack(state.camTrack, state.localStream));
      }
      state.camOn = true; applyTrackState();
    } catch { toast("Turn on your camera to use a virtual background"); return; }
  }
  try {
    toast("Applying background…");
    if (!state.vbg) state.vbg = new VirtualBg();
    if (state.vbg.running) { state.vbg.setMode(mode); }
    else { state.vbgTrack = await state.vbg.start(state.camTrack, mode); }
    state.vbgMode = mode;
    applyVideoOutput();
    toast("Virtual background applied");
  } catch (err) {
    console.warn("virtual bg failed", err);
    toast("Virtual background unavailable on this device");
    state.vbgMode = "none";
  }
}

// Decide which video track goes out: screen share > virtual bg > camera.
function applyVideoOutput() {
  let track = null;
  if (state.sharing && state.screenTrack) track = state.screenTrack;
  else if (state.vbgMode !== "none" && state.vbgTrack) track = state.vbgTrack;
  else if (state.camTrack && state.camTrack.readyState === "live") track = state.camTrack;
  state.mesh?.replaceVideoTrack(track);
  refreshSelfTile(track ? new MediaStream([track]) : state.localStream);
}

// --------------------------------------------------------------- schedule
function wireSchedule() {
  if (wireSchedule.done) return; wireSchedule.done = true;
  el.schedNewBtn.onclick = () => { el.schedForm.hidden = false; el.schedTitle.focus(); };
  el.schedCancel.onclick = () => { el.schedForm.hidden = true; };
  el.schedForm.onsubmit = async (e) => {
    e.preventDefault();
    const title = el.schedTitle.value.trim() || "Meeting";
    const when = el.schedWhen.value;
    const room = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const r = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + state.token },
        body: JSON.stringify({ title, when, room }),
      });
      if (r.ok) { el.schedForm.hidden = true; el.schedTitle.value = ""; el.schedWhen.value = ""; loadSchedule(); toast("Meeting scheduled"); }
      else toast("Could not schedule");
    } catch { toast("Network error"); }
  };
}

async function loadSchedule() {
  try {
    const r = await fetch("/api/meetings", { headers: { Authorization: "Bearer " + state.token } });
    if (!r.ok) return;
    const { meetings } = await r.json();
    renderSchedule(meetings || []);
  } catch {}
}

function renderSchedule(meetings) {
  el.schedList.innerHTML = "";
  if (!meetings.length) { el.schedList.innerHTML = '<div class="sched-empty">No meetings scheduled yet.</div>'; return; }
  for (const m of meetings) {
    const item = document.createElement("div"); item.className = "sched-item";
    const when = m.when ? new Date(m.when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Any time";
    item.innerHTML = `<div class="si-main"><div class="si-title"></div><div class="si-when"></div></div><div class="si-act"></div>`;
    item.querySelector(".si-title").textContent = m.title;
    item.querySelector(".si-when").textContent = when;
    const act = item.querySelector(".si-act");
    const start = document.createElement("button"); start.className = "ghost small"; start.textContent = "Start";
    start.onclick = () => { el.roomInput.value = m.room; join(); };
    const copy = document.createElement("button"); copy.className = "ghost small"; copy.textContent = "🔗";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}/room/${m.room}`); toast("Invite copied"); } catch {} };
    const del = document.createElement("button"); del.className = "ghost small"; del.textContent = "🗑️";
    del.onclick = async () => { await fetch("/api/meetings/" + m.id, { method: "DELETE", headers: { Authorization: "Bearer " + state.token } }); loadSchedule(); };
    act.append(start, copy, del);
    el.schedList.appendChild(item);
  }
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
  const params = new URLSearchParams(location.search);
  state.skip = params.get("skip") === "1";
  state.mainRoom = params.get("main") || "";
  localStorage.setItem("zl_name", name);

  el.joinBtn.disabled = true;
  el.lobbyHint.textContent = "Getting camera & microphone…";

  await setupMedia();

  // Load runtime config (ICE servers, recording upload URL).
  try { state.config = await (await fetch("/api/config")).json(); }
  catch { state.config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], recordingUploadUrl: "" }; }

  history.replaceState(null, "", `/room/${roomId}${location.search}`);
  el.lobby.hidden = true; el.room.hidden = false;
  el.roomTitle.textContent = roomId;
  // Breakout banner + return button.
  if (state.mainRoom) {
    el.breakoutBanner.hidden = false;
    el.returnMain.onclick = () => { location.href = `/room/${encodeURIComponent(state.mainRoom)}?skip=1`; };
  }

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

  // Raise / lower hand.
  el.handBtn.onclick = () => {
    state.hand = !state.hand;
    el.handBtn.classList.toggle("on", state.hand);
    state.sig?.send({ type: "hand", up: state.hand });
    setTileHand("self", state.hand);
    renderPeople();
  };

  // Reactions.
  el.reactBtn.onclick = (e) => { e.stopPropagation(); el.reactMenu.hidden = !el.reactMenu.hidden; };
  el.reactMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.sig?.send({ type: "react", emoji: b.dataset.emoji });
      showReaction(state.name, b.dataset.emoji);
      el.reactMenu.hidden = true;
    };
  });

  // Recording with a destination menu.
  if (!state.config?.recordingUploadUrl) el.recServerOpt.disabled = true;
  el.recBtn.onclick = (e) => {
    e.stopPropagation();
    if (state.recorder.recording) return stopRecording();
    el.recMenu.hidden = !el.recMenu.hidden;
  };
  el.recMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { el.recMenu.hidden = true; startRecording(b.dataset.target); };
  });

  // Participants panel.
  el.peopleBtn.onclick = () => { el.people.hidden = !el.people.hidden; renderPeople(); };
  el.peopleClose.onclick = () => (el.people.hidden = true);
  el.muteAllBtn.onclick = () => {
    if (!isHost()) return;
    state.sig?.send({ type: "host-mute", target: "all" });
    toast("Muted everyone");
  };
  el.lowerHandsBtn.onclick = () => {
    if (!isHost()) return;
    state.sig?.send({ type: "hand-lower-all" });
    state.hand = false; el.handBtn.classList.remove("on"); setTileHand("self", false);
    for (const [id, p] of state.peers) { p.hand = false; setTileHand(id, false); }
    renderPeople(); toast("Lowered all hands");
  };
  el.waitingToggle.onchange = () => {
    if (!isHost()) return;
    state.waiting = el.waitingToggle.checked;
    state.sig?.send({ type: "waiting-toggle", on: state.waiting });
  };

  // Waiting room (participant) cancel.
  el.waitLeave.onclick = () => leave();

  // Breakout rooms (host).
  el.breakoutBtn.onclick = () => { el.people.hidden = true; el.breakout.hidden = false; };
  el.breakoutClose.onclick = () => (el.breakout.hidden = true);
  el.brkCreate.onclick = () => buildBreakouts();
  el.brkOpen.onclick = () => {
    if (!state.breakouts.length) return;
    state.sig?.send({ type: "breakout-open", rooms: state.breakouts });
    toast("Breakout rooms opened"); el.breakout.hidden = true;
  };
  el.brkCloseAll.onclick = () => { state.sig?.send({ type: "breakout-close" }); toast("Closing breakout rooms"); };

  // Virtual background.
  el.bgVideoBtn.onclick = (e) => { e.stopPropagation(); el.bgVideoMenu.hidden = !el.bgVideoMenu.hidden; };
  el.bgVideoMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { el.bgVideoMenu.hidden = true; setVirtualBg(b.dataset.vbg); };
  });

  // Close popovers on outside click.
  document.addEventListener("click", (e) => {
    if (!el.reactMenu.hidden && !el.reactMenu.contains(e.target) && e.target !== el.reactBtn) el.reactMenu.hidden = true;
    if (!el.recMenu.hidden && !el.recMenu.contains(e.target) && e.target !== el.recBtn) el.recMenu.hidden = true;
    if (!el.bgVideoMenu.hidden && !el.bgVideoMenu.contains(e.target) && e.target !== el.bgVideoBtn) el.bgVideoMenu.hidden = true;
  });

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
    const to = el.chatTo.value || null;
    state.sig?.send({ type: "chat", text, to });
    const toName = to ? state.peers.get(to)?.name : null;
    addChat(state.name, text, true, toName);
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
  state.micOn = !state.micOn; applyTrackState(); broadcastMedia();
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
  state.camOn = !state.camOn; applyTrackState(); broadcastMedia();
}

function broadcastMedia() {
  state.sig?.send({ type: "media", mic: state.micOn, cam: state.camOn });
  const self = state.tiles.get("self");
  if (self) self.div.classList.toggle("muted", !state.micOn);
  renderPeople();
}

async function toggleShare() {
  if (state.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.screenTrack = s.getVideoTracks()[0];
    state.sharing = true;
    el.shareBtn.classList.add("on");
    applyVideoOutput();
    state.screenTrack.onended = () => stopShare();
  } catch { /* user cancelled */ }
}

function stopShare() {
  if (!state.sharing) return;
  state.sharing = false;
  el.shareBtn.classList.remove("on");
  try { state.screenTrack.stop(); } catch {}
  state.screenTrack = null;
  applyVideoOutput();
}

function startRecording(target) {
  state.recTarget = target === "server" ? "server" : "computer";
  const audio = [state.localStream, ...[...state.tiles.values()].map((t) => t.stream)].filter(Boolean);
  const bgColors = { dark: "#0e1730", white: "#ffffff", slate: "#334155", blue: "#0b3d91", green: "#0f5132", grid: "#12203f", dots: "#12203f" };
  state.recorder.start({
    boardCanvas: el.board,
    tiles: () => [...state.tiles.values()].map((t) => ({ video: t.video, label: t.label.textContent })),
    bgColor: bgColors[el.boardWrap.dataset.bg] || "#0e1730",
    audioStreams: audio,
  });
  el.recBtn.classList.add("rec-on");
  el.connState.classList.add("rec"); el.connState.textContent = "● recording";
  toast(state.recTarget === "server" ? "Recording… will upload to your server" : "Recording… you'll choose where to save");
}

async function stopRecording() {
  el.recBtn.classList.remove("rec-on");
  el.connState.classList.remove("rec");
  el.connState.textContent = "connected"; el.connState.classList.add("ok");
  const res = await state.recorder.stop(state.roomId, state.recTarget);
  const msg = {
    server: "Recording uploaded to your server ✓",
    chosen: "Recording saved ✓",
    downloads: "Recording saved to Downloads ✓",
    cancelled: "Save cancelled — recording discarded",
  }[res?.where] || "Recording saved";
  toast(msg);
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
  const sig = new Signaling(state.roomId, state.name, state.token, state.skip);
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

  sig.addEventListener("waiting", () => {
    el.waitingScreen.hidden = false;
    el.waitRoom.textContent = state.roomId;
  });

  sig.addEventListener("welcome", (e) => {
    const { self, host, peers, board, waiting } = e.detail;
    state.selfId = self; state.host = host; state.waiting = waiting !== false;
    el.waitingScreen.hidden = true; // admitted
    mesh.setSelf(self);
    state.board.loadShapes(board);
    for (const p of peers) {
      state.peerNames.set(p.id, p.name);
      state.peers.set(p.id, { name: p.name, mic: true, cam: true, hand: false });
      mesh.addPeer(p.id, p.name);
    }
    el.waitingToggle.checked = state.waiting;
    updateHostUI(); renderPeople(); refreshChatTo();
    broadcastMedia();
  });

  // Host receives a request to admit someone from the waiting room.
  sig.addEventListener("wait-request", (e) => {
    state.waitingList.set(e.detail.id, e.detail.name);
    renderWaiting();
    toast(`✋ ${e.detail.name} is waiting to join`);
  });
  sig.addEventListener("denied", () => { alert("The host did not admit you to the meeting."); leave(); });
  sig.addEventListener("waiting-state", (e) => { state.waiting = e.detail.on; el.waitingToggle.checked = e.detail.on; });

  sig.addEventListener("hand-lower-all", () => {
    state.hand = false; el.handBtn.classList.remove("on"); setTileHand("self", false);
    for (const [id, p] of state.peers) { p.hand = false; setTileHand(id, false); }
    renderPeople();
  });

  sig.addEventListener("breakout-open", (e) => {
    const { room, roomName } = e.detail;
    toast(`Joining breakout: ${roomName || room}`);
    setTimeout(() => { location.href = `/room/${encodeURIComponent(room)}?main=${encodeURIComponent(state.roomId)}&skip=1`; }, 800);
  });
  sig.addEventListener("breakout-close", () => {
    if (state.mainRoom) { toast("Returning to main room…"); setTimeout(() => (location.href = `/room/${encodeURIComponent(state.mainRoom)}?skip=1`), 600); }
  });

  sig.addEventListener("peer-join", (e) => {
    const { id, name } = e.detail;
    state.peerNames.set(id, name);
    state.peers.set(id, { name, mic: true, cam: true, hand: false });
    mesh.addPeer(id, name);
    if (state.waitingList.delete(id)) renderWaiting();
    renderPeople(); refreshChatTo();
    toast(`${name} joined`);
  });

  sig.addEventListener("peer-leave", (e) => {
    const p = state.peers.get(e.detail.id);
    mesh.removePeer(e.detail.id);
    state.peers.delete(e.detail.id);
    renderPeople(); refreshChatTo();
    if (p) toast(`${p.name} left`);
  });

  sig.addEventListener("host", (e) => { state.host = e.detail.id; updateHostUI(); renderPeople(); });

  sig.addEventListener("media", (e) => {
    const p = state.peers.get(e.detail.id);
    if (p) { p.mic = e.detail.mic; p.cam = e.detail.cam; }
    const t = state.tiles.get(e.detail.id);
    if (t) t.div.classList.toggle("muted", !e.detail.mic);
    renderPeople();
  });

  sig.addEventListener("hand", (e) => {
    const p = state.peers.get(e.detail.id);
    if (p) p.hand = e.detail.up;
    setTileHand(e.detail.id, e.detail.up);
    renderPeople();
    if (e.detail.up) toast(`✋ ${e.detail.name} raised their hand`);
  });

  sig.addEventListener("react", (e) => showReaction(e.detail.name, e.detail.emoji));

  sig.addEventListener("force-mute", (e) => {
    if (state.micOn) { state.micOn = false; applyTrackState(); broadcastMedia(); }
    toast(`🔇 You were muted by ${e.detail.by}`);
  });

  sig.addEventListener("removed", (e) => {
    alert(`You were removed from the meeting by ${e.detail.by}.`);
    leave();
  });

  sig.addEventListener("signal", (e) => mesh.handleSignal(e.detail.from, e.detail.name, e.detail.data));
  sig.addEventListener("draw", (e) => state.board.addRemoteShape(e.detail.shape));
  sig.addEventListener("erase", (e) => state.board.removeShape(e.detail.id));
  sig.addEventListener("clear", () => state.board.clearAll());
  sig.addEventListener("cursor", (e) => {
    const { id, name, x, y } = e.detail;
    state.board.showCursor(id, name, x, y, colorFor(id));
  });
  sig.addEventListener("chat", (e) => addChat(e.detail.name, e.detail.text, false, null, !!e.detail.to));

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
  // Reflect current roster state.
  const info = isSelf ? { mic: state.micOn, hand: state.hand } : state.peers.get(id);
  if (info) { tile.div.classList.toggle("muted", !info.mic); if (info.hand) setTileHand(id, true); }
  refreshTileHostBadges();
  return tile;
}

function refreshTileHostBadges() {
  for (const [id, t] of state.tiles) {
    const realId = id === "self" ? state.selfId : id;
    let b = t.div.querySelector(".host-badge");
    if (realId && realId === state.host) {
      if (!b) { b = document.createElement("span"); b.className = "host-badge"; b.textContent = "Host"; t.div.appendChild(b); }
    } else if (b) b.remove();
  }
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
function addChat(who, text, me, toName = null, isPrivate = false) {
  const div = document.createElement("div");
  div.className = "chat-msg" + (me ? " me" : "") + (isPrivate ? " private" : "");
  const whoEl = document.createElement("div"); whoEl.className = "who";
  whoEl.textContent = me ? (toName ? `You → ${toName}` : "You") : who;
  if (isPrivate) { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "private"; whoEl.appendChild(tag); }
  const body = document.createElement("div"); body.className = "body"; body.textContent = text;
  div.append(whoEl, body);
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (!me && el.chat.hidden) toast(`💬 ${who}${isPrivate ? " (private)" : ""}: ${text.slice(0, 40)}`);
}

// ----------------------------------------------------- participants panel
function renderPeople() {
  if (!el.peopleList) return;
  const rows = [];
  rows.push(personRow(state.selfId || "self", state.name, { mic: state.micOn, cam: state.camOn, hand: state.hand }, true));
  for (const [id, p] of state.peers) rows.push(personRow(id, p.name, p, false));
  el.peopleList.innerHTML = "";
  rows.forEach((r) => el.peopleList.appendChild(r));
  el.peopleCount.textContent = String(1 + state.peers.size);
}

function personRow(id, name, s, self) {
  const row = document.createElement("div");
  row.className = "prow";
  const nm = document.createElement("span");
  nm.className = "pname";
  nm.textContent = name + (self ? " (you)" : "");
  row.appendChild(nm);
  if (id === state.host) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "Host"; row.appendChild(b); }
  if (s.hand) { const h = document.createElement("span"); h.className = "pstate hand-up"; h.textContent = "✋"; row.appendChild(h); }
  const st = document.createElement("span"); st.className = "pstate"; st.textContent = (s.mic ? "🎙️" : "🔇") + (s.cam ? "" : "🚫"); row.appendChild(st);

  if (!self) {
    const dm = document.createElement("button");
    dm.className = "pact"; dm.textContent = "Message";
    dm.onclick = () => { el.chatTo.value = id; el.chat.hidden = false; el.people.hidden = true; el.chatInput.focus(); };
    row.appendChild(dm);
    if (isHost()) {
      const mute = document.createElement("button");
      mute.className = "pact"; mute.textContent = "Mute";
      mute.onclick = () => state.sig?.send({ type: "host-mute", target: id });
      row.appendChild(mute);
      const rm = document.createElement("button");
      rm.className = "pact"; rm.textContent = "Remove";
      rm.onclick = () => { if (confirm(`Remove ${name}?`)) state.sig?.send({ type: "host-remove", target: id }); };
      row.appendChild(rm);
    }
  }
  return row;
}

function updateHostUI() {
  el.hostTools.hidden = !isHost();
  el.waitingToggle.checked = state.waiting;
  renderWaiting();
  refreshTileHostBadges();
}

function renderWaiting() {
  const host = isHost();
  el.waitingWrap.hidden = !host || state.waitingList.size === 0;
  if (!host) return;
  el.waitingList.innerHTML = "";
  for (const [id, name] of state.waitingList) {
    const row = document.createElement("div");
    row.className = "prow";
    const nm = document.createElement("span"); nm.className = "pname"; nm.textContent = name;
    const admit = document.createElement("button"); admit.className = "pact"; admit.textContent = "Admit";
    admit.onclick = () => { state.sig?.send({ type: "admit", id }); state.waitingList.delete(id); renderWaiting(); };
    const deny = document.createElement("button"); deny.className = "pact"; deny.textContent = "Deny";
    deny.onclick = () => { state.sig?.send({ type: "deny", id }); state.waitingList.delete(id); renderWaiting(); };
    row.append(nm, admit, deny);
    el.waitingList.appendChild(row);
  }
}

function refreshChatTo() {
  const cur = el.chatTo.value;
  el.chatTo.innerHTML = '<option value="">Everyone</option>';
  for (const [id, p] of state.peers) {
    const o = document.createElement("option");
    o.value = id; o.textContent = p.name;
    el.chatTo.appendChild(o);
  }
  if ([...el.chatTo.options].some((o) => o.value === cur)) el.chatTo.value = cur;
}

function setTileHand(id, up) {
  const t = state.tiles.get(id === state.selfId ? "self" : id) || state.tiles.get(id);
  if (!t) return;
  let h = t.div.querySelector(".hand");
  if (up) {
    if (!h) { h = document.createElement("span"); h.className = "hand"; h.textContent = "✋"; t.div.appendChild(h); }
  } else if (h) h.remove();
}

function showReaction(name, emoji) {
  const d = document.createElement("div");
  d.className = "reaction";
  d.style.left = 20 + Math.random() * 60 + "%";
  d.innerHTML = `<div>${emoji}</div>`;
  const n = document.createElement("span"); n.className = "rname"; n.textContent = name;
  d.appendChild(n);
  el.reactionLayer.appendChild(d);
  setTimeout(() => d.remove(), 3000);
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
