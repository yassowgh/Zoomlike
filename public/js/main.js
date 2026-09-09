// App orchestrator: lobby -> room, media, signaling, mesh, whiteboard, chat,
// recording. Vanilla ES modules, no build step.

import { Signaling } from "./signaling.js";
import { Whiteboard } from "./whiteboard.js";
import { Mesh } from "./rtc.js";
import { Recorder } from "./recorder.js";
import { VirtualBg } from "./virtualbg.js";
import { SpeakerDetector } from "./speaking.js";
import * as Devices from "./devices.js";

const $ = (id) => document.getElementById(id);
const el = {
  lobby: $("lobby"), room: $("room"),
  nameInput: $("nameInput"), roomInput: $("roomInput"),
  randomRoomBtn: $("randomRoomBtn"), joinBtn: $("joinBtn"),
  lobbyHint: $("lobbyHint"),
  roomTitle: $("roomTitle"), copyLinkBtn: $("copyLinkBtn"),
  connState: $("connState"),
  bgBtn: $("bgBtn"), bgMenu: $("bgMenu"),
  viewBtn: $("viewBtn"), viewMenu: $("viewMenu"), moreBtn: $("moreBtn"), moreMenu: $("moreMenu"),
  boardToggleBtn: $("boardToggleBtn"), boardOnToggle: $("boardOnToggle"),
  controls: $("controls"), moreCtrlBtn: $("moreCtrlBtn"), toolsBtn: $("toolsBtn"),
  spotStage: $("spotStage"), spotVideo: $("spotVideo"), spotWho: $("spotWho"),
  spotTag: $("spotTag"), spotEmpty: $("spotEmpty"),
  requestWrap: $("requestWrap"), requestList: $("requestList"), recBanner: $("recBanner"),
  endedModal: $("endedModal"), endedOk: $("endedOk"),
  quickJoin: $("quickJoin"), qjForm: $("qjForm"), qjName: $("qjName"), qjRoom: $("qjRoom"),
  qjHint: $("qjHint"), qjSignIn: $("qjSignIn"), qjSubmit: $("qjSubmit"),
  googleBox: $("googleBox"), googleBtn: $("googleBtn"),
  forgotRow: $("forgotRow"), forgotBtn: $("forgotBtn"), forgotForm: $("forgotForm"),
  forgotEmail: $("forgotEmail"), forgotSubmit: $("forgotSubmit"), forgotCancel: $("forgotCancel"),
  resetScreen: $("resetScreen"), resetForm: $("resetForm"), resetPassword: $("resetPassword"),
  resetSubmit: $("resetSubmit"), resetHint: $("resetHint"), resetCancel: $("resetCancel"),
  schedAccess: $("schedAccess"),
  // pre-join preview
  prejoin: $("prejoin"), pjVideo: $("pjVideo"), pjCamOff: $("pjCamOff"), pjLevel: $("pjLevel"),
  pjTitle: $("pjTitle"), pjRoom: $("pjRoom"), pjName: $("pjName"), pjJoin: $("pjJoin"), pjHint: $("pjHint"),
  pjCamSel: $("pjCamSel"), pjMicSel: $("pjMicSel"), pjSpkSel: $("pjSpkSel"), pjSpkField: $("pjSpkField"),
  pjMic: $("pjMic"), pjCam: $("pjCam"),
  // in-meeting devices
  devices: $("devices"), devicesBtn: $("devicesBtn"), devicesClose: $("devicesClose"),
  camSel: $("camSel"), micSel: $("micSel"), spkSel: $("spkSel"), spkField: $("spkField"), devHint: $("devHint"),
  // meeting extras
  meetClock: $("meetClock"), muteEntryToggle: $("muteEntryToggle"),
  renameBtn: $("renameBtn"), renameModal: $("renameModal"), renameInput: $("renameInput"),
  renameCancel: $("renameCancel"), renameSave: $("renameSave"),
  // breakouts
  brkMinutes: $("brkMinutes"), brkLive: $("brkLive"), brkRoomList: $("brkRoomList"),
  brkMsg: $("brkMsg"), brkSend: $("brkSend"), brkCountdown: $("brkCountdown"), brkAskBtn: $("brkAskBtn"),
  // chat files
  chatAttach: $("chatAttach"), chatFile: $("chatFile"),
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
  // whiteboard v2 + permissions + export + screen stage
  imageBtn: $("imageBtn"), imageInput: $("imageInput"), zoomIn: $("zoomIn"), zoomOut: $("zoomOut"), zoomFit: $("zoomFit"),
  selBar: $("selBar"), selLock: $("selLock"), selDelete: $("selDelete"), noDrawHint: $("noDrawHint"),
  screenStage: $("screenStage"), screenVideo: $("screenVideo"), screenWho: $("screenWho"), screenHide: $("screenHide"), screenPeek: $("screenPeek"),
  allowDrawToggle: $("allowDrawToggle"), allowShareToggle: $("allowShareToggle"), endMeetingBtn: $("endMeetingBtn"),
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
  canDraw: true, canShare: true, canRecord: true, allowDraw: false, allowShare: false,
  // Permission granted to *me* personally by the host, as opposed to the
  // meeting-wide allowDraw/allowShare toggles.
  grantShare: false, grantRecord: false,
  screenIds: new Map(), // peerId -> announced screen stream id
  seenStreams: new Map(), // peerId -> [streams]
  // Shared meeting surface (host-controlled, mirrored to everyone).
  boardOn: true, boardBg: "dark", spotlight: null,
  // Per-viewer view preference.
  layout: "board", strip: "right",
  // Screen share currently on the main stage, and whether this viewer hid it.
  screenActive: null, screenDismissed: false,
  // Host-side queue of pending "may I share / record?" asks.
  requests: new Map(),
  // connId -> name for everyone currently recording, so the room can show it.
  recorders: new Map(),
  // Active-speaker detection: loudest right now, and the last non-self speaker.
  speech: null, activeSpeaker: null, lastRemoteSpeaker: null,
  access: "approval",
  // Roles: the host, plus anyone they promoted to co-host.
  moderator: false, amHost: false,
  // Meeting clock and breakout session state.
  startedAt: 0, clockTimer: 0, breakoutRooms: [], breakoutEndsAt: null, brkTimer: 0,
  // Chat attachments being reassembled, keyed by file id.
  incoming: new Map(),
  devices: { audioinput: [], videoinput: [], audiooutput: [] },
};
// The host is the meeting owner. A moderator is the host OR a co-host they
// promoted; almost all controls are open to moderators, and only ending the
// meeting and managing co-hosts are reserved for the host.
const isHost = () => !!state.amHost;
const isModerator = () => !!state.moderator;

// Effective permissions = host status, the meeting-wide toggles, or a personal
// grant from the host. Recomputed whenever any of those three change.
function recomputePerms() {
  state.canDraw = isModerator() || state.allowDraw;
  state.canShare = isModerator() || state.allowShare || state.grantShare;
  state.canRecord = isModerator() || state.grantRecord;
}

// Debug/testing hook: lets end-to-end tests inspect live app state.
window.__zl_state = state;

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
  wireQuickJoin();
  wirePasswordReset();
  wirePrejoin();

  // Which sign-in options this deployment can actually offer.
  try {
    state.config = await (await fetch("/api/config")).json();
    el.googleBox.hidden = !state.config.googleAuth;
  } catch { el.googleBox.hidden = true; }

  // Coming back from Google: the token rides in the fragment so it never
  // reaches a server log. Take it and scrub it from the address bar.
  if (location.hash.startsWith("#token=")) {
    const t = decodeURIComponent(location.hash.slice(7));
    history.replaceState(null, "", location.pathname + location.search);
    if (t) { localStorage.setItem("zl_token", t); sessionStorage.setItem("zl_token", t); }
  }
  const params = new URLSearchParams(location.search);
  const authError = params.get("autherror");
  if (authError) {
    history.replaceState(null, "", location.pathname);
    showAuth();
    el.authHint.textContent = authError;
    return;
  }
  // A password-reset link takes priority over everything else.
  const resetToken = params.get("reset");
  if (resetToken) return showReset(resetToken);
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
  // Someone following an invite link is here to attend a meeting, not to open
  // an account: send them straight in.
  const invited = roomFromUrl();
  if (invited) return showQuickJoin(invited);
  showAuth();
}

function showAuth() {
  el.quickJoin.hidden = true; el.resetScreen.hidden = true;
  el.auth.hidden = false; el.lobby.hidden = true; el.room.hidden = true;
  showGuestOption();
  el.authEmail.focus();
}

// ------------------------------------------------- forgot / reset password
function showReset(token) {
  state.resetToken = token;
  el.resetScreen.hidden = false;
  el.auth.hidden = true; el.quickJoin.hidden = true; el.lobby.hidden = true; el.room.hidden = true;
  el.resetPassword.focus();
}

function wirePasswordReset() {
  el.googleBtn.onclick = () => {
    // Come back to wherever they were, so an invite link survives sign-in.
    const to = location.pathname + location.search;
    location.href = "/api/auth/google/start?to=" + encodeURIComponent(to);
  };

  const showForgot = (on) => {
    el.forgotForm.hidden = !on;
    el.authForm.hidden = on;
    el.forgotRow.hidden = on;
    el.authHint.textContent = "";
    if (on) el.forgotEmail.value = el.authEmail.value, el.forgotEmail.focus();
  };
  el.forgotBtn.onclick = () => showForgot(true);
  el.forgotCancel.onclick = () => showForgot(false);

  el.forgotForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = el.forgotEmail.value.trim();
    if (!email) return;
    el.forgotSubmit.disabled = true;
    el.authHint.textContent = "Sending…";
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      // The reply is identical whether or not the address is registered, so
      // this never reveals who has an account. Close the form first — it
      // clears the hint line on the way out.
      showForgot(false);
      el.authHint.textContent = data.configured
        ? "If that email has an account, a reset link is on its way. It expires in 30 minutes."
        : "Password reset email is not configured on this server yet — ask the person running it.";
    } catch {
      el.authHint.textContent = "Network error. Please try again.";
    } finally {
      el.forgotSubmit.disabled = false;
    }
  };

  el.resetCancel.onclick = () => { history.replaceState(null, "", "/"); showAuth(); };
  el.resetForm.onsubmit = async (e) => {
    e.preventDefault();
    const password = el.resetPassword.value;
    if (!password) return;
    el.resetSubmit.disabled = true;
    el.resetHint.textContent = "Saving…";
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: state.resetToken, password }),
      });
      const data = await r.json();
      if (!r.ok) { el.resetHint.textContent = data.error || "Could not set your password."; return; }
      localStorage.setItem("zl_token", data.token);
      history.replaceState(null, "", "/");
      enterLobby(data);
    } catch {
      el.resetHint.textContent = "Network error. Please try again.";
    } finally {
      el.resetSubmit.disabled = false;
    }
  };
}

// ---- Quick join: name only, or nothing at all if we already know it -------
function showQuickJoin(room) {
  el.quickJoin.hidden = false; el.auth.hidden = true; el.lobby.hidden = true; el.room.hidden = true;
  el.qjRoom.textContent = room;
  const remembered = (localStorage.getItem("zl_name") || "").trim();
  if (remembered) return quickJoinAs(remembered);
  el.qjName.focus();
}

function wireQuickJoin() {
  el.qjForm.onsubmit = (e) => {
    e.preventDefault();
    const name = el.qjName.value.trim().slice(0, 40);
    if (!name) { el.qjName.focus(); return; }
    quickJoinAs(name);
  };
  // Escape hatch for people who do want their account (scheduling, hosting).
  el.qjSignIn.onclick = () => showAuth();
}

async function quickJoinAs(name) {
  el.qjSubmit.disabled = true;
  el.qjHint.textContent = "Joining…";
  try {
    const r = await fetch("/api/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!r.ok) { el.qjHint.textContent = data.error || "Could not join."; return; }
    localStorage.setItem("zl_name", name);
    enterLobby(data); // initLobby sees the room in the URL and joins immediately
  } catch {
    el.qjHint.textContent = "Network error. Please try again.";
  } finally {
    el.qjSubmit.disabled = false;
  }
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
    el.forgotRow.hidden = reg;
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
  el.quickJoin.hidden = true; el.resetScreen.hidden = true;
  el.auth.hidden = true; el.lobby.hidden = false; el.room.hidden = true;
  // Scheduling is for registered users only.
  el.schedSection.hidden = state.isGuest;
  // Guests can't own a room, so the access chooser is not theirs to set.
  const accessField = document.querySelector(".access-field");
  if (accessField) accessField.hidden = state.isGuest;
  if (!state.isGuest) { wireSchedule(); loadSchedule(); }
  initLobby();
}

function logout() {
  localStorage.removeItem("zl_token"); sessionStorage.removeItem("zl_token");
  state.token = ""; state.name = ""; state.email = "";
  location.href = "/";
}

// The board background belongs to the meeting: the host picks it and
// everyone's board changes with it.
function applyBackground(name) {
  state.boardBg = name;
  el.boardWrap.dataset.bg = name;
}

// ------------------------------------------------------------ view layout
// Three main surfaces can occupy the stage — the whiteboard, a shared screen,
// and a single large speaker/spotlight video. This decides which one is up,
// and where the participant strip sits.
function applyLayout() {
  // The viewer's stored preference, overridden while the host is directing
  // attention or the whiteboard is unavailable. state.layout itself is never
  // rewritten, so the preference comes back when the override lifts.
  let layout = state.layout;
  if (state.spotlight) layout = "speaker";
  else if (layout === "board" && !state.boardOn) layout = "speaker";
  el.room.dataset.layout = layout;
  el.room.dataset.strip = state.strip;

  const sharing = !!state.screenActive;
  const showScreen = sharing && !state.screenDismissed;
  el.screenStage.hidden = !showScreen;
  el.boardWrap.hidden = showScreen || layout !== "board";
  el.spotStage.hidden = showScreen || layout !== "speaker";
  if (el.screenPeek) el.screenPeek.hidden = !(sharing && state.screenDismissed);

  if (!el.spotStage.hidden) renderSpotlight();
  if (!el.boardWrap.hidden) state.board?.resize();

  // Mark the active choices in the View menu.
  el.viewMenu.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === layout);
    if (b.dataset.view === "board") b.disabled = !state.boardOn;
  });
  el.viewMenu.querySelectorAll("[data-strip]").forEach((b) => b.classList.toggle("active", b.dataset.strip === state.strip));

  localStorage.setItem("zl_layout", state.layout);
  localStorage.setItem("zl_strip", state.strip);
}

// Who gets the big tile in speaker view: the host's spotlight wins, then
// whoever spoke last (excluding you, so your own face doesn't take the stage
// every time you talk), then any peer, then you.
function pickSpeaker() {
  if (state.spotlight) return state.spotlight;
  if (state.lastRemoteSpeaker && state.peers.has(state.lastRemoteSpeaker)) return state.lastRemoteSpeaker;
  const first = state.peers.keys().next();
  return first.done ? state.selfId : first.value;
}

// Outline whoever is talking, and swing the speaker stage to them.
function onSpeechChange(active, remote) {
  state.activeSpeaker = active;
  state.lastRemoteSpeaker = remote;
  for (const [tid, t] of state.tiles) {
    const realId = tid === "self" ? state.selfId : tid;
    t.div.classList.toggle("speaking", !!active && (realId === active || tid === active));
  }
  if (!el.spotStage.hidden && !state.spotlight) renderSpotlight();
}

function renderSpotlight() {
  const id = pickSpeaker();
  const tile = state.tiles.get(id === state.selfId ? "self" : id);
  const stream = tile?.stream || null;
  el.spotEmpty.hidden = !!stream;
  el.spotVideo.hidden = !stream;
  if (stream && el.spotVideo.srcObject !== stream) {
    el.spotVideo.srcObject = stream;
    el.spotVideo.play?.().catch(() => {});
  }
  // The strip tiles already play everyone's audio — never play it twice.
  el.spotVideo.muted = true;
  el.spotWho.textContent = id === state.selfId ? "You" : (state.peerNames.get(id) || "Someone");
  el.spotTag.hidden = !state.spotlight;
  for (const [tid, t] of state.tiles) {
    const realId = tid === "self" ? state.selfId : tid;
    t.div.classList.toggle("spotlighted", !!state.spotlight && realId === state.spotlight);
  }
}

// Applies the host-controlled whiteboard on/off switch. This deliberately does
// NOT touch state.layout: that is the viewer's own preference, and applyLayout
// substitutes speaker view while the board is off, so turning the board back
// on returns them to the whiteboard.
function applyBoardState() {
  // The host switches the board on and off; everyone else can only ask for it
  // to be started, and only while it is off.
  if (isModerator()) {
    el.boardToggleBtn.textContent = state.boardOn ? "🖊️ Turn whiteboard off" : "🖊️ Turn whiteboard on";
    el.boardToggleBtn.hidden = false;
  } else {
    el.boardToggleBtn.textContent = "🖊️ Ask to start the whiteboard";
    el.boardToggleBtn.hidden = state.boardOn;
  }
  if (el.boardOnToggle) el.boardOnToggle.checked = state.boardOn;
  applyLayout();
}

// ------------------------------------------------------------- breakouts
// Everything a moderator sees while breakout rooms are open: which rooms
// exist, how long is left, and a way to hop into any of them.
function renderBreakoutState() {
  const open = state.breakoutRooms.length > 0;
  el.brkLive.hidden = !open || !isModerator();
  el.brkRoomList.innerHTML = "";
  if (open && isModerator()) {
    for (const r of state.breakoutRooms) {
      const row = document.createElement("div");
      row.className = "brk-room-row";
      const nm = document.createElement("span"); nm.className = "rn"; nm.textContent = r.name || r.room;
      const join = document.createElement("button"); join.className = "pact"; join.textContent = "Join";
      join.onclick = () => {
        const main = state.mainRoom || state.roomId;
        location.href = `/room/${encodeURIComponent(r.room)}?main=${encodeURIComponent(main)}&skip=1`;
      };
      row.append(nm, join);
      el.brkRoomList.appendChild(row);
    }
  }
  // Countdown, shown to everyone in a breakout and to moderators in the main room.
  clearInterval(state.brkTimer);
  const paint = () => {
    if (!state.breakoutEndsAt) { el.brkCountdown.hidden = true; return; }
    const left = Math.max(0, Math.floor((state.breakoutEndsAt - Date.now()) / 1000));
    const m = Math.floor(left / 60), sc = left % 60;
    el.brkCountdown.textContent = `⏳ ${m}:${String(sc).padStart(2, "0")} left`;
    el.brkCountdown.hidden = false;
    if (left <= 0) clearInterval(state.brkTimer);
  };
  if (state.breakoutEndsAt) { paint(); state.brkTimer = setInterval(paint, 1000); }
  else el.brkCountdown.hidden = true;
}

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

// Camera output: virtual background if on, else the raw camera. (Screen share
// is a SEPARATE track now, so it never replaces the camera.)
function applyVideoOutput() {
  let track = null;
  if (state.vbgMode !== "none" && state.vbgTrack) track = state.vbgTrack;
  else if (state.camTrack && state.camTrack.readyState === "live") track = state.camTrack;
  state.mesh?.replaceVideoTrack(track);
  refreshSelfTile(track ? new MediaStream([track]) : state.localStream);
}

function routeStream(peerId, name, stream) {
  const list = state.seenStreams.get(peerId) || [];
  if (!list.includes(stream)) list.push(stream);
  state.seenStreams.set(peerId, list);
  if (state.screenIds.get(peerId) === stream.id) showScreen(state.peerNames.get(peerId) || name, stream);
  else addTile(peerId, state.peerNames.get(peerId) || name, stream);
}

function applyPermUI() {
  el.noDrawHint.hidden = state.canDraw || !state.boardOn;
  // Share and record stay enabled without permission — pressing them asks the
  // host rather than doing nothing.
  el.shareBtn.title = state.canShare ? "Share your screen" : "Ask the host to let you share";
  el.recBtn.title = state.canRecord ? "Record the session" : "Ask the host to let you record";
  el.shareBtn.classList.toggle("needs-ask", !state.canShare);
  el.recBtn.classList.toggle("needs-ask", !state.canRecord);
  if (el.allowDrawToggle) el.allowDrawToggle.checked = state.allowDraw;
  if (el.allowShareToggle) el.allowShareToggle.checked = state.allowShare;
  // Only the host changes the shared board background.
  el.bgBtn.hidden = !isModerator();
  if (!isModerator()) el.bgMenu.hidden = true;
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
    const access = el.schedAccess.value === "open" ? "open" : "approval";
    const room = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const r = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + state.token },
        body: JSON.stringify({ title, when, room, access }),
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
    const when = (m.when ? new Date(m.when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Any time")
      + (m.access === "open" ? " · open to anyone" : " · you approve");
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

// ------------------------------------------------------- pre-join preview
// Nobody can see or hear you here. This is where you confirm the camera is
// pointing the right way and the right microphone is picked up.
let pjStream = null, pjStopMeter = null;

async function openPrejoin(roomId) {
  state.roomId = roomId;
  el.prejoin.hidden = false;
  el.quickJoin.hidden = true; el.auth.hidden = true; el.lobby.hidden = true; el.room.hidden = true;
  el.pjRoom.textContent = roomId ? `Room: ${roomId}` : "";
  el.pjName.value = state.name || localStorage.getItem("zl_name") || "";
  el.pjSpkField.hidden = !Devices.canChooseSpeaker();
  state.micOn = true; state.camOn = true;
  paintPrejoinToggles();
  await startPrejoinPreview();
  el.pjJoin.focus();
}

function paintPrejoinToggles() {
  el.pjMic.textContent = state.micOn ? "🎙️ Mic on" : "🔇 Mic off";
  el.pjCam.textContent = state.camOn ? "📷 Camera on" : "🚫 Camera off";
  el.pjMic.classList.toggle("off", !state.micOn);
  el.pjCam.classList.toggle("off", !state.camOn);
  el.pjCamOff.hidden = state.camOn;
}

async function startPrejoinPreview() {
  stopPrejoinPreview();
  const want = {
    audio: state.micOn ? deviceConstraint("audioinput", el.pjMicSel.value) : false,
    video: state.camOn ? deviceConstraint("videoinput", el.pjCamSel.value) : false,
  };
  if (!want.audio && !want.video) { el.pjVideo.srcObject = null; return; }
  try {
    pjStream = await navigator.mediaDevices.getUserMedia(want);
  } catch (err) {
    console.warn("preview failed", err);
    el.pjHint.textContent = "We couldn't open your camera or microphone. You can still join.";
    return;
  }
  el.pjVideo.srcObject = pjStream;
  el.pjVideo.play?.().catch(() => {});
  // Labels only exist once permission has been granted, so list them now.
  await refreshDeviceLists();
  const audio = pjStream.getAudioTracks()[0];
  if (audio) pjStopMeter = Devices.meter(new MediaStream([audio]), (v) => {
    el.pjLevel.style.width = Math.round(v * 100) + "%";
  });
}

function stopPrejoinPreview() {
  if (pjStopMeter) { pjStopMeter(); pjStopMeter = null; }
  if (pjStream) { pjStream.getTracks().forEach((t) => t.stop()); pjStream = null; }
  el.pjLevel.style.width = "0%";
}

function deviceConstraint(kind, chosen) {
  const id = chosen || Devices.recall(kind);
  return id ? { deviceId: { exact: id } } : true;
}

function wirePrejoin() {
  el.pjMic.onclick = async () => { state.micOn = !state.micOn; paintPrejoinToggles(); await startPrejoinPreview(); };
  el.pjCam.onclick = async () => { state.camOn = !state.camOn; paintPrejoinToggles(); await startPrejoinPreview(); };
  el.pjCamSel.onchange = async () => { Devices.remember("videoinput", el.pjCamSel.value); await startPrejoinPreview(); };
  el.pjMicSel.onchange = async () => { Devices.remember("audioinput", el.pjMicSel.value); await startPrejoinPreview(); };
  el.pjSpkSel.onchange = () => Devices.remember("audiooutput", el.pjSpkSel.value);
  el.pjJoin.onclick = () => {
    const name = el.pjName.value.trim().slice(0, 40);
    if (!name) { el.pjHint.textContent = "Please enter your name."; el.pjName.focus(); return; }
    localStorage.setItem("zl_name", name);
    state.name = name;
    el.nameInput.value = name;
    stopPrejoinPreview();
    el.prejoin.hidden = true;
    join();
  };
  Devices.onDeviceChange(async () => {
    await refreshDeviceLists();
    if (!el.prejoin.hidden) await startPrejoinPreview();
    else if (!el.room.hidden) toast("Audio or video devices changed");
  });
}

// ------------------------------------------------------------ device picker
async function refreshDeviceLists() {
  state.devices = await Devices.listDevices();
  const fill = (sel, list, kind) => {
    if (!sel) return;
    const current = sel.value || Devices.recall(kind);
    sel.innerHTML = "";
    for (const d of list) {
      const o = document.createElement("option");
      o.value = d.deviceId; o.textContent = d.label;
      sel.appendChild(o);
    }
    if (list.some((d) => d.deviceId === current)) sel.value = current;
  };
  fill(el.pjCamSel, state.devices.videoinput, "videoinput");
  fill(el.pjMicSel, state.devices.audioinput, "audioinput");
  fill(el.pjSpkSel, state.devices.audiooutput, "audiooutput");
  fill(el.camSel, state.devices.videoinput, "videoinput");
  fill(el.micSel, state.devices.audioinput, "audioinput");
  fill(el.spkSel, state.devices.audiooutput, "audiooutput");
}

// Swap hardware without dropping the call: grab the new track, hand it to
// every peer connection, and retire the old one.
async function switchDevice(kind, deviceId) {
  Devices.remember(kind, deviceId);
  if (kind === "audiooutput") {
    const media = [...state.tiles.values()].map((t) => t.video).concat([el.spotVideo, el.screenVideo]);
    const ok = await Devices.applySpeaker(deviceId, media.filter(Boolean));
    el.devHint.textContent = ok ? "Speaker changed." : "This browser can't choose an output device.";
    return;
  }
  try {
    const want = kind === "audioinput"
      ? { audio: { deviceId: { exact: deviceId } } }
      : { video: { deviceId: { exact: deviceId } } };
    const fresh = await navigator.mediaDevices.getUserMedia(want);
    const track = fresh.getTracks()[0];
    if (!track) return;

    const old = kind === "audioinput"
      ? state.localStream.getAudioTracks()[0]
      : state.localStream.getVideoTracks()[0];
    if (old) { state.localStream.removeTrack(old); old.stop(); }
    state.localStream.addTrack(track);

    if (kind === "audioinput") {
      track.enabled = state.micOn;
      state.mesh?.replaceAudioTrack(track);
      // The speaking meter is watching the old track.
      state.speech?.remove("self");
      state.speech?.add("self", state.localStream);
    } else {
      track.enabled = state.camOn;
      state.camTrack = track;
      // Re-run any virtual background on the new camera.
      if (state.vbgMode !== "none") await setVirtualBg(state.vbgMode);
      else applyVideoOutput();
    }
    el.devHint.textContent = `${kind === "audioinput" ? "Microphone" : "Camera"} changed.`;
  } catch (err) {
    console.warn("device switch failed", err);
    el.devHint.textContent = "Could not switch to that device.";
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
    el.joinBtn.onclick = () => startJoin();
    el.logoutBtn.onclick = logout;
    el.roomInput.addEventListener("keydown", (e) => e.key === "Enter" && startJoin());
  }
  if (urlRoom) startJoin();
}

// Everyone passes through the camera check on the way in — except when the
// meeting itself is moving you, which is what skip=1 marks. Being bounced
// into a breakout room and asked "ready to join?" would be absurd, and your
// devices were already chosen on the way into the meeting.
function startJoin() {
  const roomId = (el.roomInput.value || "").trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
  if (!roomId) { el.lobbyHint.textContent = "Please enter a room name."; return; }
  const accessPick = document.querySelector('input[name="access"]:checked');
  state.access = accessPick && accessPick.value === "open" ? "open" : "approval";
  if (new URLSearchParams(location.search).get("skip") === "1") {
    state.roomId = roomId;
    return join();
  }
  openPrejoin(roomId);
}

// ----------------------------------------------------------------- join
async function join() {
  const name = (el.nameInput.value || "Guest").trim().slice(0, 40) || "Guest";
  const roomId = (el.roomInput.value || "").trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
  if (!roomId) { el.lobbyHint.textContent = "Please enter a room name."; return; }

  state.name = name; state.roomId = roomId;
  // state.micOn / state.camOn and the device choices were settled on the
  // pre-join screen, so they are deliberately not re-read here.
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
  const want = {
    audio: state.micOn ? deviceConstraint("audioinput", el.pjMicSel.value) : false,
    video: state.camOn ? deviceConstraint("videoinput", el.pjCamSel.value) : false,
  };
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

  const sendShape = (o) => { const { mine, ...rest } = o; state.sig?.send({ type: "draw", shape: rest }); };
  wb.onAdd = sendShape;
  wb.onUpdate = sendShape;
  wb.onDelete = (id) => state.sig?.send({ type: "erase", id });
  wb.onCursor = throttle((x, y) => state.sig?.send({ type: "cursor", x, y }), 60);
  wb.onSelect = (o) => updateSelBar(o);

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
    if (!state.canDraw) return toast("You don't have drawing permission");
    if (confirm("Clear the whiteboard for everyone?")) { wb.clearAll(); state.sig?.send({ type: "clear" }); }
  };

  el.zoomIn.onclick = () => wb.zoomBy(1.2);
  el.zoomOut.onclick = () => wb.zoomBy(1 / 1.2);
  el.zoomFit.onclick = () => wb.resetView();

  el.selDelete.onclick = () => wb.deleteSelected();
  el.selLock.onclick = () => wb.toggleLockSelected();

  el.imageBtn.onclick = () => { if (!state.canDraw) return toast("You don't have drawing permission"); el.imageInput.click(); };
  el.imageInput.onchange = () => { const f = el.imageInput.files[0]; if (f) readImage(f, (src) => wb.insertImage(src)); el.imageInput.value = ""; };
  window.addEventListener("paste", (e) => {
    if (el.room.hidden || !state.canDraw) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { const f = item.getAsFile(); if (f) readImage(f, (src) => wb.insertImage(src)); }
  });

  // Drawing tools stay hidden behind a button on phones.
  el.toolsBtn.onclick = () => {
    const open = el.boardWrap.classList.toggle("tools-open");
    el.toolsBtn.classList.toggle("on", open);
  };

  document.addEventListener("keydown", (e) => {
    if (el.room.hidden) return;
    if ((e.key === "Delete" || e.key === "Backspace") && wb.selectedId && !e.target.matches("input, textarea")) { e.preventDefault(); wb.deleteSelected(); }
  });
}

function updateSelBar(o) {
  el.selBar.hidden = !(o && state.canDraw);
  if (o) el.selLock.textContent = o.locked ? "🔓 Unlock" : "🔒 Lock";
}

function readImage(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1000; let w = img.width, h = img.height; const s = Math.min(1, max / Math.max(w, h));
      const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

async function exportBoard(kind) {
  const bg = { dark: "#0e1730", white: "#ffffff", slate: "#334155", blue: "#0b3d91", green: "#0f5132", grid: "#12203f", dots: "#12203f" }[el.boardWrap.dataset.bg] || "#0e1730";
  const { url, w, h } = state.board.exportImage(bg);
  if (kind === "png") { const a = document.createElement("a"); a.href = url; a.download = `whiteboard-${Date.now()}.png`; document.body.appendChild(a); a.click(); a.remove(); toast("Saved PNG"); return; }
  try {
    if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: w >= h ? "l" : "p", unit: "pt", format: [w, h] });
    pdf.addImage(url, "PNG", 0, 0, w, h);
    pdf.save(`whiteboard-${Date.now()}.pdf`);
    toast("Saved PDF");
  } catch (e) { console.warn(e); toast("PDF export failed"); }
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
    // Anyone who is not the host needs the host's go-ahead before recording.
    if (!state.canRecord) {
      state.sig?.send({ type: "record-request" });
      toast("Asked the host for permission to record");
      return;
    }
    el.recMenu.hidden = !el.recMenu.hidden;
  };
  el.recMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { el.recMenu.hidden = true; startRecording(b.dataset.target); };
  });

  // Phones show essentials only; "More" reveals the rest.
  el.moreCtrlBtn.onclick = (e) => { e.stopPropagation(); el.controls.classList.toggle("expanded"); };
  el.controls.querySelectorAll('.ctrl-item[data-pri="2"] .ctrl').forEach((b) => {
    b.addEventListener("click", () => el.controls.classList.remove("expanded"));
  });

  // Participants panel.
  el.peopleBtn.onclick = () => { panelOpen("people") ? closePanels() : showPanel("people"); renderPeople(); };
  el.peopleClose.onclick = () => closePanels();
  el.muteAllBtn.onclick = () => {
    if (!isModerator()) return;
    state.sig?.send({ type: "host-mute", target: "all" });
    toast("Muted everyone");
  };
  el.lowerHandsBtn.onclick = () => {
    if (!isModerator()) return;
    state.sig?.send({ type: "hand-lower-all" });
    state.hand = false; el.handBtn.classList.remove("on"); setTileHand("self", false);
    for (const [id, p] of state.peers) { p.hand = false; setTileHand(id, false); }
    renderPeople(); toast("Lowered all hands");
  };
  el.waitingToggle.onchange = () => {
    if (!isModerator()) return;
    state.waiting = el.waitingToggle.checked;
    state.sig?.send({ type: "waiting-toggle", on: state.waiting });
  };
  el.allowDrawToggle.onchange = () => { if (isModerator()) state.sig?.send({ type: "allow-draw", on: el.allowDrawToggle.checked }); };
  el.allowShareToggle.onchange = () => { if (isModerator()) state.sig?.send({ type: "allow-share", on: el.allowShareToggle.checked }); };
  el.boardOnToggle.onchange = () => {
    if (!isModerator()) return;
    state.sig?.send({ type: "board-toggle", on: el.boardOnToggle.checked });
  };
  el.boardToggleBtn.onclick = () => {
    el.moreMenu.hidden = true;
    if (isModerator()) { state.sig?.send({ type: "board-toggle", on: !state.boardOn }); return; }
    // Starting the whiteboard is the host's call, so ask instead.
    state.sig?.send({ type: "board-request" });
    toast("Asked the host to start the whiteboard");
  };
  el.endMeetingBtn.onclick = () => {
    if (!isHost()) return;
    if (confirm("End the meeting for everyone?")) { state.sig?.send({ type: "end-session" }); leave(); }
  };

  // Step away from a shared screen and back to it.
  el.screenHide.onclick = () => { state.screenDismissed = true; applyLayout(); };
  if (el.screenPeek) el.screenPeek.onclick = () => { state.screenDismissed = false; applyLayout(); };

  // Waiting room (participant) cancel.
  el.waitLeave.onclick = () => leave();

  // Breakout rooms (host).
  el.breakoutBtn.onclick = () => { showPanel("breakout"); renderBreakoutState(); };
  el.breakoutClose.onclick = () => closePanels();
  el.brkCreate.onclick = () => buildBreakouts();
  el.brkOpen.onclick = () => {
    if (!state.breakouts.length) return;
    const minutes = Math.max(0, Math.min(180, parseInt(el.brkMinutes.value, 10) || 0));
    state.sig?.send({ type: "breakout-open", rooms: state.breakouts, minutes });
    toast(minutes ? `Breakout rooms opened for ${minutes} min` : "Breakout rooms opened");
    el.breakout.hidden = true;
  };
  el.brkCloseAll.onclick = () => { state.sig?.send({ type: "breakout-close" }); toast("Closing breakout rooms"); };
  el.brkSend.onclick = () => {
    const text = el.brkMsg.value.trim();
    if (!text) return;
    state.sig?.send({ type: "breakout-announce", text });
    el.brkMsg.value = "";
    toast("Announcement sent to every room");
  };
  // Asking to switch rooms from inside a breakout.
  el.brkAskBtn.onclick = () => {
    const room = prompt("Which room would you like to move to? Leave blank to ask to return to the main room.", "");
    if (room === null) return;
    state.sig?.send({ type: "breakout-ask", room: room.trim() });
    toast("Asked the host to move you");
  };

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

  // View menu: how participants are laid out, and where they sit.
  el.viewBtn.onclick = (e) => { e.stopPropagation(); el.viewMenu.hidden = !el.viewMenu.hidden; el.moreMenu.hidden = true; };
  el.viewMenu.querySelectorAll("[data-view]").forEach((b) => {
    b.onclick = () => { state.layout = b.dataset.view; el.viewMenu.hidden = true; applyLayout(); };
  });
  el.viewMenu.querySelectorAll("[data-strip]").forEach((b) => {
    b.onclick = () => { state.strip = b.dataset.strip; el.viewMenu.hidden = true; applyLayout(); };
  });

  // More menu: board background + board export.
  el.moreBtn.onclick = (e) => { e.stopPropagation(); el.moreMenu.hidden = !el.moreMenu.hidden; el.viewMenu.hidden = true; };
  el.moreMenu.querySelectorAll("[data-exp]").forEach((b) => {
    b.onclick = () => { el.moreMenu.hidden = true; exportBoard(b.dataset.exp); };
  });

  // Board background picker — host only, and shared with the whole meeting.
  applyBackground(state.boardBg);
  el.bgBtn.onclick = (e) => {
    e.stopPropagation();
    el.moreMenu.hidden = true;
    el.bgMenu.hidden = !el.bgMenu.hidden;
  };
  el.bgMenu.querySelectorAll(".bg-swatch").forEach((b) => {
    b.onclick = () => {
      el.bgMenu.hidden = true;
      if (!isModerator()) return;
      applyBackground(b.dataset.bg);
      state.sig?.send({ type: "board-bg", bg: b.dataset.bg });
    };
  });
  document.addEventListener("click", (e) => {
    if (!el.bgMenu.hidden && !el.bgMenu.contains(e.target) && e.target !== el.bgBtn) el.bgMenu.hidden = true;
    if (!el.viewMenu.hidden && !el.viewMenu.contains(e.target) && e.target !== el.viewBtn) el.viewMenu.hidden = true;
    if (!el.moreMenu.hidden && !el.moreMenu.contains(e.target) && e.target !== el.moreBtn) el.moreMenu.hidden = true;
    if (el.controls.classList.contains("expanded") && !el.controls.contains(e.target)) el.controls.classList.remove("expanded");
  });

  el.endedOk.onclick = () => { location.href = "/"; };

  // Audio & video settings inside the meeting.
  el.devicesBtn.onclick = async () => {
    el.moreMenu.hidden = true;
    showPanel("devices");
    el.spkField.hidden = !Devices.canChooseSpeaker();
    el.devHint.textContent = "";
    await refreshDeviceLists();
  };
  el.devicesClose.onclick = () => closePanels();
  el.camSel.onchange = () => switchDevice("videoinput", el.camSel.value);
  el.micSel.onchange = () => switchDevice("audioinput", el.micSel.value);
  el.spkSel.onchange = () => switchDevice("audiooutput", el.spkSel.value);

  // Rename yourself.
  el.renameBtn.onclick = () => {
    el.moreMenu.hidden = true;
    el.renameInput.value = state.name;
    el.renameModal.hidden = false;
    el.renameInput.focus(); el.renameInput.select();
  };
  el.renameCancel.onclick = () => (el.renameModal.hidden = true);
  el.renameSave.onclick = () => {
    const name = el.renameInput.value.trim().slice(0, 40);
    el.renameModal.hidden = true;
    if (!name || name === state.name) return;
    state.name = name;
    localStorage.setItem("zl_name", name);
    state.sig?.send({ type: "rename", name });
    const self = state.tiles.get("self");
    if (self) self.label.textContent = name + " (you)";
    renderPeople();
    toast("You're now " + name);
  };
  el.renameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") el.renameSave.click(); });

  el.muteEntryToggle.onchange = () => {
    if (!isModerator()) return;
    state.sig?.send({ type: "mute-on-entry", on: el.muteEntryToggle.checked });
  };

  // Side panels are positioned below the topbar, whose height changes when its
  // buttons wrap, so publish the measured height as a CSS variable.
  syncTopbarHeight();
  window.addEventListener("resize", syncTopbarHeight);

  // Restore this viewer's layout preference.
  state.layout = localStorage.getItem("zl_layout") || "board";
  state.strip = localStorage.getItem("zl_strip") || "right";
  applyLayout();

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

  el.chatAttach.onclick = () => el.chatFile.click();
  el.chatFile.onchange = () => {
    const f = el.chatFile.files[0];
    el.chatFile.value = "";
    if (f) sendChatFile(f).catch((err) => { console.warn(err); toast("Could not send that file"); });
  };
  el.chatBtn.onclick = () => {
    if (panelOpen("chat")) return closePanels();
    showPanel("chat"); el.chatInput.focus();
  };
  el.chatClose.onclick = () => closePanels();
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
  if (!state.canShare) {
    state.sig?.send({ type: "share-request" });
    toast("Asked the host for permission to share your screen");
    return;
  }
  if (state.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.screenStream = s;
    state.screenTrack = s.getVideoTracks()[0];
    state.sharing = true;
    el.shareBtn.classList.add("on");
    state.mesh?.setScreenStream(s);         // ADDS a track; camera keeps running
    state.sig?.send({ type: "screen", on: true, streamId: s.id });
    showScreen("You", s);
    state.screenTrack.onended = () => stopShare();
  } catch { /* user cancelled */ }
}

function stopShare() {
  if (!state.sharing) return;
  state.sharing = false;
  el.shareBtn.classList.remove("on");
  try { state.screenTrack.stop(); } catch {}
  state.mesh?.stopScreenStream();
  state.sig?.send({ type: "screen", on: false });
  state.screenTrack = null; state.screenStream = null;
  hideScreen();
}

function showScreen(name, stream) {
  state.screenActive = { name, stream };
  state.screenDismissed = false;
  el.screenVideo.srcObject = stream;
  el.screenWho.textContent = name || "Someone";
  applyLayout();
  el.screenVideo.play?.().catch(() => {});
}
function hideScreen() {
  state.screenActive = null;
  state.screenDismissed = false;
  el.screenVideo.srcObject = null;
  applyLayout();
}

function startRecording(target) {
  state.recTarget = target === "server" ? "server" : "computer";
  // Tell the room. The server consumes a non-host's permission here, so the
  // next recording needs the host to approve it again.
  state.sig?.send({ type: "recording", on: true });
  if (!isModerator()) { state.grantRecord = false; recomputePerms(); applyPermUI(); }
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
  state.sig?.send({ type: "recording", on: false });
  el.recBtn.classList.remove("rec-on");
  el.connState.classList.remove("rec");
  el.connState.textContent = "connected"; el.connState.classList.add("ok");
  const res = await state.recorder.stop(state.roomId, state.recTarget);
  const msg = {
    server: "Recording uploaded to your server ✓",
    chosen: "Recording saved ✓",
    downloads: "Recording saved to Downloads ✓",
    opened: "Recording opened — use the share button to save it to Files",
    cancelled: "Save cancelled — recording discarded",
  }[res?.where] || "Recording saved";
  toast(msg);
}

function leave() {
  try { state.recorder?.recording && state.recorder.stop(state.roomId); } catch {}
  state.speech?.stop();
  state.sig?.close();
  state.mesh?.closeAll();
  state.localStream?.getTracks().forEach((t) => t.stop());
  location.href = "/";
}

// ------------------------------------------------------------ signaling
function connect() {
  const sig = new Signaling(state.roomId, state.name, state.token, state.skip, { access: state.access });
  state.sig = sig;

  const mesh = new Mesh({
    iceServers: state.config?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
    send: (to, data) => sig.send({ type: "signal", to, data }),
    onStream: (peerId, name, stream) => routeStream(peerId, name, stream),
    onLeave: (peerId) => {
      removeTile(peerId); state.board?.removeCursor(peerId); state.seenStreams.delete(peerId);
      if (state.screenIds.has(peerId)) { state.screenIds.delete(peerId); hideScreen(); }
    },
  });
  mesh.setLocalStream(state.localStream);
  state.mesh = mesh;

  state.speech = new SpeakerDetector(onSpeechChange);
  state.speech.add("self", state.localStream);

  sig.addEventListener("open", () => { el.connState.textContent = "connected"; el.connState.classList.add("ok"); });
  sig.addEventListener("close", () => { el.connState.textContent = "reconnecting…"; el.connState.classList.remove("ok"); });

  sig.addEventListener("waiting", () => {
    el.waitingScreen.hidden = false;
    el.waitRoom.textContent = state.roomId;
  });

  sig.addEventListener("welcome", (e) => {
    const { self, host, peers, board, waiting, allowDraw, allowShare,
            boardOn, boardBg, spotlight, startedAt, muteOnEntry, moderator,
            isHost: amHost, breakouts, breakoutEndsAt, mainRoom } = e.detail;
    state.moderator = !!moderator; state.amHost = !!amHost;
    state.startedAt = startedAt || Date.now();
    state.breakoutRooms = breakouts || [];
    state.breakoutEndsAt = breakoutEndsAt || null;
    if (mainRoom && !state.mainRoom) state.mainRoom = mainRoom;
    state.selfId = self; state.host = host; state.waiting = waiting !== false;
    state.speech?.setSelfId(self);
    state.allowDraw = !!allowDraw; state.allowShare = !!allowShare;
    state.grantShare = !!e.detail.grantShare; state.grantRecord = !!e.detail.grantRecord;
    state.boardOn = boardOn !== false;
    state.spotlight = spotlight || null;
    applyBackground(boardBg || "dark");
    el.waitingScreen.hidden = true; // admitted
    mesh.setSelf(self);
    state.board.loadShapes(board);
    state.board.setCanDraw(state.canDraw);
    for (const p of peers) {
      state.peerNames.set(p.id, p.name);
      state.peers.set(p.id, { name: p.name, mic: true, cam: true, hand: false, moderator: !!p.moderator });
      mesh.addPeer(p.id, p.name);
    }
    // The host can ask that people arrive muted.
    if (muteOnEntry && state.micOn) { state.micOn = false; applyTrackState(); }
    if (el.muteEntryToggle) el.muteEntryToggle.checked = !!muteOnEntry;
    startMeetingClock();
    renderBreakoutState();
    el.waitingToggle.checked = state.waiting;
    updateHostUI(); renderPeople(); refreshChatTo(); applyPermUI();
    applyBoardState();
    broadcastMedia();
  });

  // ---- shared surface state pushed by the host ----
  sig.addEventListener("board-state", (e) => {
    state.boardOn = !!e.detail.on;
    applyBoardState();
    toast(state.boardOn ? "The host turned the whiteboard on" : "The host turned the whiteboard off");
  });
  sig.addEventListener("board-bg", (e) => { applyBackground(e.detail.bg); });
  sig.addEventListener("spotlight", (e) => {
    state.spotlight = e.detail.id || null;
    applyLayout(); renderPeople();
    if (state.spotlight) {
      const who = state.spotlight === state.selfId ? "You are" : `${state.peerNames.get(state.spotlight) || "Someone"} is`;
      toast(`📌 ${who} spotlighted`);
    } else toast("Spotlight removed");
  });

  // ---- permission requests ----
  sig.addEventListener("share-request", (e) => addRequest("share", e.detail.id, e.detail.name));
  sig.addEventListener("record-request", (e) => addRequest("record", e.detail.id, e.detail.name));
  sig.addEventListener("share-decision", (e) => {
    state.grantShare = !!e.detail.ok;
    recomputePerms();
    applyPermUI();
    toast(e.detail.ok ? "The host allowed screen sharing — press Share" : "The host declined your screen share request");
  });
  sig.addEventListener("recording-state", (e) => {
    const { id, name, on } = e.detail;
    if (on) state.recorders.set(id, name); else state.recorders.delete(id);
    updateRecordingBanner();
    if (id !== state.selfId) toast(on ? `⏺️ ${name} started recording` : `⏹️ ${name} stopped recording`);
  });

  sig.addEventListener("board-decision", (e) => {
    toast(e.detail.ok ? "The host started the whiteboard" : "The host declined to start the whiteboard");
  });
  sig.addEventListener("board-request", (e) => addRequest("board", e.detail.id, e.detail.name));

  sig.addEventListener("record-decision", (e) => {
    state.grantRecord = !!e.detail.ok;
    recomputePerms();
    applyPermUI();
    toast(e.detail.ok ? "The host allowed recording — press Record" : "The host declined your recording request");
  });

  sig.addEventListener("perm", (e) => {
    if (e.detail.what === "draw") state.allowDraw = e.detail.on;
    if (e.detail.what === "share") state.allowShare = e.detail.on;
    recomputePerms();
    state.board.setCanDraw(state.canDraw);
    applyPermUI();
    toast(e.detail.what === "draw" ? (e.detail.on ? "Everyone can draw now" : "Drawing restricted to host") : (e.detail.on ? "Everyone can share now" : "Sharing restricted to host"));
  });

  sig.addEventListener("session-end", () => {
    // Tear down locally and stop reconnecting — the room has been reset
    // server-side, so there is nothing left to rejoin.
    try { state.recorder?.recording && state.recorder.stop(state.roomId); } catch {}
    state.sig?.close();
    state.speech?.stop();
    state.mesh?.closeAll();
    state.localStream?.getTracks().forEach((t) => t.stop());
    el.endedModal.hidden = false;
  });

  // Screen share routing (screen shows on the main stage; cameras keep running).
  sig.addEventListener("screen", (e) => {
    const { id, name, on, streamId } = e.detail;
    if (on) {
      state.screenIds.set(id, streamId);
      const streams = state.seenStreams.get(id) || [];
      const match = streams.find((s) => s.id === streamId) || streams[streams.length - 1];
      if (match) showScreen(name, match);
    } else {
      state.screenIds.delete(id);
      hideScreen();
    }
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
    // Keep pointing at the ORIGINAL main room even when moving between
    // breakouts, or "return to main" would send us to another breakout.
    const main = state.mainRoom || state.roomId;
    setTimeout(() => { location.href = `/room/${encodeURIComponent(room)}?main=${encodeURIComponent(main)}&skip=1`; }, 800);
  });
  sig.addEventListener("breakout-close", () => {
    if (state.mainRoom) { toast("Returning to main room…"); setTimeout(() => (location.href = `/room/${encodeURIComponent(state.mainRoom)}?skip=1`), 600); }
  });

  sig.addEventListener("peer-join", (e) => {
    const { id, name, moderator } = e.detail;
    state.peerNames.set(id, name);
    state.peers.set(id, { name, mic: true, cam: true, hand: false, moderator: !!moderator });
    mesh.addPeer(id, name);
    if (state.waitingList.delete(id)) renderWaiting();
    renderPeople(); refreshChatTo(); applyLayout();
    toast(`${name} joined`);
  });

  sig.addEventListener("peer-leave", (e) => {
    const p = state.peers.get(e.detail.id);
    mesh.removePeer(e.detail.id);
    state.peers.delete(e.detail.id);
    for (const kind of ["share", "record", "board"]) state.requests.delete(`${kind}:${e.detail.id}`);
    if (state.recorders.delete(e.detail.id)) updateRecordingBanner();
    renderPeople(); refreshChatTo(); renderRequests(); applyLayout();
    if (p) toast(`${p.name} left`);
  });

  sig.addEventListener("host", (e) => { state.host = e.detail.id; updateHostUI(); renderPeople(); });

  // ---- roles, renaming, arrival muting ----
  sig.addEventListener("cohost", (e) => {
    state.moderator = !!e.detail.on;
    recomputePerms(); updateHostUI(); renderPeople(); applyBoardState();
    toast(e.detail.on ? `⭐ ${e.detail.by} made you a co-host` : "You are no longer a co-host");
  });
  sig.addEventListener("peer-role", (e) => {
    const p = state.peers.get(e.detail.id);
    if (p) p.moderator = !!e.detail.moderator;
    renderPeople();
  });
  sig.addEventListener("renamed", (e) => {
    const { id, name } = e.detail;
    state.peerNames.set(id, name);
    const p = state.peers.get(id);
    if (p) p.name = name;
    const t = state.tiles.get(id);
    if (t) t.label.textContent = name;
    renderPeople(); refreshChatTo();
    if (!el.spotStage.hidden) renderSpotlight();
  });
  sig.addEventListener("mute-on-entry", (e) => {
    if (el.muteEntryToggle) el.muteEntryToggle.checked = !!e.detail.on;
  });

  // ---- breakout rooms ----
  sig.addEventListener("breakout-state", (e) => {
    state.breakoutRooms = e.detail.rooms || [];
    state.breakoutEndsAt = e.detail.endsAt || null;
    renderBreakoutState();
  });
  sig.addEventListener("breakout-ask", (e) => {
    const { id, name, room, from } = e.detail;
    addRequest("move", id, name, { room, from });
  });
  sig.addEventListener("breakout-announce", (e) => {
    addChat(e.detail.by || "Host", "📢 " + e.detail.text, false);
    toast("📢 " + e.detail.text);
  });

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

  // Incoming attachment: open a row, then fill it slice by slice.
  sig.addEventListener("file-start", (e) => {
    const { fileId, fileName, size, mime, chunks, name, to } = e.detail;
    const row = addChat(name, "", false, null, !!to, { fileName, size, fileId });
    state.incoming.set(fileId, { row, parts: new Array(chunks), got: 0, chunks, fileName, mime });
  });
  sig.addEventListener("file-chunk", (e) => {
    const rec = state.incoming.get(e.detail.fileId);
    if (!rec || rec.parts[e.detail.i]) return;
    rec.parts[e.detail.i] = b64ToBytes(e.detail.data);
    rec.got += 1;
    setFileProgress(rec.row, rec.got / rec.chunks);
    if (rec.got === rec.chunks) {
      setFileReady(rec.row, new Blob(rec.parts, { type: rec.mime }), rec.fileName);
      state.incoming.delete(e.detail.fileId);
    }
  });
  sig.addEventListener("file-error", (e) => toast(e.detail.error || "File could not be sent"));

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
  state.speech?.add(id, stream);
  tile.label.textContent = name + (isSelf ? " (you)" : "");
  tile.video.play?.().catch(() => {});
  // Reflect current roster state.
  const info = isSelf ? { mic: state.micOn, hand: state.hand } : state.peers.get(id);
  if (info) { tile.div.classList.toggle("muted", !info.mic); if (info.hand) setTileHand(id, true); }
  refreshTileHostBadges();
  // A newly arrived stream may be the one the speaker stage is waiting for.
  if (!el.spotStage.hidden) renderSpotlight();
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
  state.speech?.remove(id);
}
function refreshSelfTile(stream) {
  const t = state.tiles.get("self");
  if (t) { t.video.srcObject = stream || state.localStream; }
}

// ---------------------------------------------------------------- chat
// Attachments are sliced so each websocket frame stays well under the
// Durable Object limit, and are relayed rather than stored — a late joiner
// will not see a file that was shared before they arrived.
const FILE_SLICE = 64 * 1024;      // bytes of source data per frame
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function sendChatFile(file) {
  if (file.size > MAX_FILE_BYTES) return toast("That file is too large (10 MB max)");
  const to = el.chatTo.value || null;
  const fileId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const chunks = Math.ceil(file.size / FILE_SLICE);
  state.sig?.send({
    type: "file-start", fileId, fileName: file.name, mime: file.type || "application/octet-stream",
    size: file.size, chunks, to,
  });
  const row = addChat(state.name, "", true, to ? state.peers.get(to)?.name : null, !!to,
    { fileName: file.name, size: file.size, fileId });
  const buf = new Uint8Array(await file.arrayBuffer());
  for (let i = 0; i < chunks; i++) {
    const slice = buf.subarray(i * FILE_SLICE, (i + 1) * FILE_SLICE);
    state.sig?.send({ type: "file-chunk", fileId, i, to, data: bytesToB64(slice) });
    setFileProgress(row, (i + 1) / chunks);
    // Yield so a big file does not lock the tab up while it uploads.
    await new Promise((r) => setTimeout(r, 0));
  }
  setFileReady(row, new Blob([buf], { type: file.type || "application/octet-stream" }), file.name);
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function setFileProgress(row, frac) {
  const bar = row?.querySelector(".cf-bar");
  if (bar) bar.style.width = Math.round(frac * 100) + "%";
}
function setFileReady(row, blob, fileName) {
  if (!row) return;
  const prog = row.querySelector(".cf-progress");
  if (prog) prog.remove();
  const holder = row.querySelector(".chat-file");
  if (!holder) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.textContent = "⤓ Save";
  holder.appendChild(a);
}

function humanSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function addChat(who, text, me, toName = null, isPrivate = false, file = null) {
  const div = document.createElement("div");
  div.className = "chat-msg" + (me ? " me" : "") + (isPrivate ? " private" : "");
  const whoEl = document.createElement("div"); whoEl.className = "who";
  whoEl.textContent = me ? (toName ? `You → ${toName}` : "You") : who;
  if (isPrivate) { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "private"; whoEl.appendChild(tag); }
  div.append(whoEl);
  if (text) { const body = document.createElement("div"); body.className = "body"; body.textContent = text; div.append(body); }
  if (file) {
    const box = document.createElement("div"); box.className = "chat-file";
    const nm = document.createElement("span"); nm.className = "cf-name"; nm.textContent = "📎 " + file.fileName;
    const sz = document.createElement("span"); sz.className = "cf-size"; sz.textContent = humanSize(file.size);
    box.append(nm, sz);
    const prog = document.createElement("div"); prog.className = "cf-progress";
    prog.innerHTML = '<div class="cf-bar"></div>';
    div.append(box, prog);
    div.dataset.fileId = file.fileId;
  }
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (!me && el.chat.hidden) {
    toast(file ? `📎 ${who} shared ${file.fileName}` : `💬 ${who}${isPrivate ? " (private)" : ""}: ${text.slice(0, 40)}`);
  }
  return div;
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
  row.dataset.pid = id;
  const nm = document.createElement("span");
  nm.className = "pname";
  nm.textContent = name + (self ? " (you)" : "");
  row.appendChild(nm);
  if (id === state.host) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "Host"; row.appendChild(b); }
  else if (s.moderator) { const b = document.createElement("span"); b.className = "badge cohost"; b.textContent = "Co-host"; row.appendChild(b); }
  if (s.hand) { const h = document.createElement("span"); h.className = "pstate hand-up"; h.textContent = "✋"; row.appendChild(h); }
  const st = document.createElement("span"); st.className = "pstate"; st.textContent = (s.mic ? "🎙️" : "🔇") + (s.cam ? "" : "🚫"); row.appendChild(st);

  if (!self) {
    const dm = document.createElement("button");
    dm.className = "pact"; dm.textContent = "Message";
    dm.onclick = () => { el.chatTo.value = id; showPanel("chat"); el.chatInput.focus(); };
    row.appendChild(dm);
    // Only the host hands out co-host, so a co-host cannot promote others.
    if (isHost()) {
      const co = document.createElement("button");
      co.className = "pact"; co.textContent = s.moderator ? "Remove co-host" : "Make co-host";
      co.onclick = () => state.sig?.send({ type: "cohost", target: id, on: !s.moderator });
      row.appendChild(co);
    }
    if (isModerator()) {
      // Send this person into a specific breakout room.
      if (state.breakoutRooms.length) {
        const to = document.createElement("select");
        to.className = "chat-select pact-select";
        to.innerHTML = '<option value="">Move to…</option><option value="__main">Main room</option>';
        for (const r of state.breakoutRooms) {
          const o = document.createElement("option");
          o.value = r.room; o.textContent = r.name || r.room;
          to.appendChild(o);
        }
        to.onchange = () => {
          if (!to.value) return;
          const room = to.value === "__main" ? "" : to.value;
          state.sig?.send({ type: "breakout-move", target: id, room, roomName: room, from: state.mainRoom ? state.roomId : "" });
          toast(`Moving ${name}…`);
          to.value = "";
        };
        row.appendChild(to);
      }
      const spot = document.createElement("button");
      const on = state.spotlight === id;
      spot.className = "pact"; spot.textContent = on ? "📌 Unspotlight" : "📌 Spotlight";
      spot.onclick = () => state.sig?.send({ type: "spotlight", target: on ? null : id });
      row.appendChild(spot);
      const mute = document.createElement("button");
      mute.className = "pact"; mute.textContent = "Mute";
      mute.onclick = () => { state.sig?.send({ type: "host-mute", target: id }); toast(`Muted ${name}`); };
      row.appendChild(mute);
      const rm = document.createElement("button");
      rm.className = "pact"; rm.textContent = "Remove";
      rm.onclick = () => { if (confirm(`Remove ${name} from the meeting?`)) state.sig?.send({ type: "host-remove", target: id }); };
      row.appendChild(rm);
    }
  }
  return row;
}

function updateHostUI() {
  el.hostTools.hidden = !isModerator();
  el.waitingToggle.checked = state.waiting;
  // The host role may have just changed hands, so re-derive permissions.
  recomputePerms();
  state.board?.setCanDraw(state.canDraw);
  applyPermUI();
  renderWaiting();
  renderRequests();
  refreshTileHostBadges();
  applyBoardState();
}

// Pending "may I share / record?" asks, shown to the host in the people panel.
function renderRequests() {
  const host = isModerator();
  el.requestWrap.hidden = !host || state.requests.size === 0;
  if (!host) return;
  el.requestList.innerHTML = "";
  for (const [key, req] of state.requests) {
    const row = document.createElement("div");
    row.className = "prow req-row";
    const txt = document.createElement("span");
    txt.className = "rtext";
    txt.textContent = req.kind === "move" && req.room
      ? `${req.name} wants to move to ${req.room}`
      : `${req.name} wants to ${REQUEST_WORDING[req.kind] || req.kind}`;
    const ok = document.createElement("button");
    ok.className = "pact approve"; ok.textContent = "Allow";
    ok.onclick = () => decideRequest(key, req, true);
    const no = document.createElement("button");
    no.className = "pact"; no.textContent = "Deny";
    no.onclick = () => decideRequest(key, req, false);
    row.append(txt, ok, no);
    el.requestList.appendChild(row);
  }
}

const REQUEST_WORDING = {
  share: "share their screen",
  record: "record the meeting",
  board: "start the whiteboard",
  move: "move to another room",
};
const DECISION_MSG = { share: "share-decision", record: "record-decision", board: "board-decision" };

function decideRequest(key, req, ok) {
  if (req.kind === "move") {
    // Approving a breakout switch means actually moving them; they may be
    // sitting in a sub-room, so `from` says which room to reach them in.
    if (ok) state.sig?.send({ type: "breakout-move", target: req.id, room: req.room || "", roomName: req.room || "", from: req.from || "" });
    state.requests.delete(key);
    renderRequests();
    toast(ok ? `Moved ${req.name}` : `Denied ${req.name}`);
    return;
  }
  state.sig?.send({ type: DECISION_MSG[req.kind], target: req.id, ok });
  state.requests.delete(key);
  renderRequests();
  toast(ok ? `Allowed ${req.name}` : `Denied ${req.name}`);
}

function addRequest(kind, id, name, extra) {
  state.requests.set(`${kind}:${id}`, { kind, id, name, ...(extra || {}) });
  renderRequests();
  if (!panelOpen("people")) { showPanel("people"); renderPeople(); }
  toast(`✋ ${name} is asking to ${REQUEST_WORDING[kind] || kind}`);
}

function renderWaiting() {
  const host = isModerator();
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

// Every side panel occupies the same strip down the right-hand side, so only
// one may be open at a time.
const SIDE_PANELS = ["people", "chat", "breakout", "devices"];
function showPanel(which) {
  for (const id of SIDE_PANELS) {
    const node = document.getElementById(id);
    if (node) node.hidden = id !== which;
  }
}
function closePanels() { showPanel(null); }
function panelOpen(which) { return !document.getElementById(which)?.hidden; }

// -------------------------------------------------------------- helpers
// A visible marker whenever anyone in the room is recording.
function updateRecordingBanner() {
  const names = [...state.recorders.values()];
  const mine = state.recorder?.recording;
  el.recBanner.hidden = names.length === 0;
  if (names.length) el.recBanner.textContent = `⏺️ Recording — ${names.join(", ")}`;
  el.recBtn.classList.toggle("rec-on", !!mine);
}

// How long the meeting has been running, ticking in the topbar.
function startMeetingClock() {
  clearInterval(state.clockTimer);
  const paint = () => {
    if (!state.startedAt) return;
    const secs = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sc = secs % 60;
    const pad = (n) => String(n).padStart(2, "0");
    el.meetClock.textContent = h ? `${h}:${pad(m)}:${pad(sc)}` : `${pad(m)}:${pad(sc)}`;
  };
  paint();
  state.clockTimer = setInterval(paint, 1000);
}

function syncTopbarHeight() {
  const tb = document.querySelector(".topbar");
  if (tb && tb.offsetHeight) document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
}

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
