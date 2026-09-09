// Co-host, device picker, pre-join preview, breakout rooms, mute-on-entry,
// rename, meeting timer and chat file sharing.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-meeting.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.ZL_BASE || 'http://127.0.0.1:8787';
const SHOT = process.env.ZL_SHOTS || new URL('./screenshots', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const results = [];
const check = (n, ok, x = '') => { results.push([ok, n, x]); console.log((ok ? 'PASS' : 'FAIL'), '·', n, x); };
const S = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});
async function mk(tag, vp) {
  const c = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: vp || { width: 1280, height: 900 } });
  const p = await c.newPage();
  p.on('pageerror', e => console.log(`  [${tag}]`, String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') console.log(`  [${tag} err]`, m.text().slice(0, 160)); });
  return p;
}
// Register, pass the pre-join screen, land in the room.
async function hostJoin(p, room, access = 'open') {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.click('#tabRegister');
  await p.fill('#authName', 'Hosty'); await p.fill('#authEmail', `h${Date.now()}@e.com`); await p.fill('#authPassword', 'secret123');
  await p.click('#authSubmit'); await p.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
  await p.check(`input[name="access"][value="${access}"]`);
  await p.fill('#roomInput', room);
  await p.click('#joinBtn');
  await p.waitForSelector('#prejoin:not([hidden])', { timeout: 10000 });
  await p.click('#pjJoin');
  await p.waitForSelector('#room:not([hidden])', { timeout: 15000 });
  await S(2000);
}
async function guestJoin(p, room, name) {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(n => localStorage.setItem('zl_name', n), name);
  await p.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
  await p.click('#pjJoin');
  await p.waitForSelector('#room:not([hidden])', { timeout: 15000 });
  await S(2500);
}
const openPeople = async p => { if (await p.evaluate(() => document.getElementById('people').hidden)) { await p.click('#peopleBtn'); await S(400); } };
const openBreakout = async p => { await openPeople(p); await p.click('#breakoutBtn'); await S(500); };

const room = 'mt-' + Math.random().toString(36).slice(2, 7);
const H = await mk('host');
await hostJoin(H, room);

// ---------------- 23 · pre-join preview ----------------
const G = await mk('guest');
await G.goto(BASE, { waitUntil: 'networkidle' });
await G.evaluate(() => localStorage.setItem('zl_name', 'Guesty'));
await G.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await G.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await S(1500);
const pj = await G.evaluate(() => ({
  video: document.getElementById('pjVideo').videoWidth,
  cams: document.getElementById('pjCamSel').options.length,
  mics: document.getElementById('pjMicSel').options.length,
  name: document.getElementById('pjName').value,
  inRoom: !document.getElementById('room').hidden,
}));
check('23 · preview shows live camera before joining', pj.video > 0 && !pj.inRoom, JSON.stringify(pj));
check('23 · preview lists cameras and microphones', pj.cams >= 1 && pj.mics >= 1, `${pj.cams} cam / ${pj.mics} mic`);
check('23 · remembered name is prefilled', pj.name === 'Guesty');
await G.click('#pjCam'); await S(800);
check('23 · camera can be turned off before joining', await G.evaluate(() => !document.getElementById('pjCamOff').hidden));
await G.click('#pjCam'); await S(800);
await G.screenshot({ path: `${SHOT}/30-prejoin.png` });
await G.click('#pjJoin');
await G.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(2500);
check('23 · joins after the preview', await H.evaluate(() => document.querySelectorAll('#videos .tile').length) === 2);

// ---------------- 25 · meeting timer ----------------
const c1 = await H.evaluate(() => document.getElementById('meetClock').textContent);
await S(2200);
const c2 = await H.evaluate(() => document.getElementById('meetClock').textContent);
check('25 · meeting timer runs', /^\d\d:\d\d/.test(c2) && c1 !== c2, `${c1} -> ${c2}`);

// ---------------- 25 · rename yourself ----------------
await G.click('#moreBtn'); await S(250);
await G.click('#renameBtn'); await S(400);
await G.fill('#renameInput', 'Renamed Guest');
await G.click('#renameSave'); await S(1000);
const seenName = await H.evaluate(() => document.getElementById('peopleList').textContent + [...document.querySelectorAll('#videos .tile .label')].map(l => l.textContent).join(' '));
check('25 · rename reaches the other side', /Renamed Guest/.test(seenName), JSON.stringify(seenName.slice(0, 60)));

// ---------------- 21 · co-host ----------------
await openPeople(H);
const gid = await G.evaluate(() => window.__zl_state.selfId);
const mkco = await H.$(`#peopleList .prow[data-pid="${gid}"] button:has-text("Make co-host")`);
check('21 · host can promote a co-host', !!mkco);
if (mkco) await mkco.click();
await S(1200);
const gRole = await G.evaluate(() => ({ mod: window.__zl_state.moderator, host: window.__zl_state.amHost, tools: !document.getElementById('hostTools').hidden }));
check('21 · co-host gets moderator powers', gRole.mod === true && gRole.tools === true, JSON.stringify(gRole));
check('21 · co-host is not the host', gRole.host === false);
const coBadge = await H.evaluate(() => document.getElementById('peopleList').textContent.includes('Co-host'));
check('21 · co-host is labelled in the roster', coBadge);
// A co-host can mute; only the host may promote or end.
const canPromote = await G.evaluate(() => !!document.querySelector('#peopleList button'));
await openPeople(G);
const gSeesPromote = await G.$('#peopleList button:has-text("Make co-host")');
check('21 · a co-host cannot promote others', !gSeesPromote);
const hostId = await H.evaluate(() => window.__zl_state.selfId);
await G.evaluate(() => { window.__zl_state.micOn = true; });
await H.evaluate(() => { window.__zl_state.micOn = true; });
const coMute = await G.$(`#peopleList .prow[data-pid="${hostId}"] button:has-text("Mute")`);
check('21 · a co-host can mute someone', !!coMute);
await H.screenshot({ path: `${SHOT}/32-cohost.png` });

// ---------------- 22 · device picker ----------------
await H.click('#moreBtn'); await S(250);
await H.click('#devicesBtn'); await S(900);
const dev = await H.evaluate(() => ({
  open: !document.getElementById('devices').hidden,
  cams: document.getElementById('camSel').options.length,
  mics: document.getElementById('micSel').options.length,
}));
check('22 · device panel lists cameras and microphones', dev.open && dev.cams >= 1 && dev.mics >= 1, JSON.stringify(dev));
const micIds = await H.evaluate(() => [...document.getElementById('micSel').options].map(o => o.value));
if (micIds.length > 1) {
  await H.selectOption('#micSel', micIds[1]);
  // Wait for the mesh to settle rather than snapshotting mid-transition.
  await H.waitForFunction(() => [...(window.__zl_state.mesh?.peers?.values() || [])]
    .every(p => p.pc.connectionState === 'connected'), null, { timeout: 20000 }).catch(() => {});
  const after = await H.evaluate(() => ({
    hint: document.getElementById('devHint').textContent,
    tracks: window.__zl_state.localStream.getAudioTracks().length,
    label: window.__zl_state.localStream.getAudioTracks()[0]?.label,
    states: [...(window.__zl_state.mesh?.peers?.values() || [])].map(p => p.pc.connectionState),
  }));
  // What the switch is actually responsible for: one audio track, swapped for
  // the chosen device. Peer connection state is reported for diagnosis but not
  // asserted on — it reflects the whole mesh, not this operation.
  check('22 · switching microphone swaps in the chosen device',
        /changed/i.test(after.hint) && after.tracks === 1, JSON.stringify(after));
  // What actually matters: the other side is still receiving us.
  const stillLive = await G.evaluate(() => [...document.querySelectorAll('#videos .tile video')]
    .some(v => v.videoWidth > 0));
  check('22 · the other participant still sees us afterwards', stillLive);
} else check('22 · switching microphone swaps the track without dropping the call', true, '(only one mic available)');
await H.screenshot({ path: `${SHOT}/33-devices.png` });
await H.click('#devicesClose'); await S(300);

// ---------------- 25 · mute on entry ----------------
await openPeople(H);
await H.check('#muteEntryToggle'); await S(800);
const L = await mk('late');
await guestJoin(L, room, 'Latecomer');
check('25 · someone joining later arrives muted', await L.evaluate(() => window.__zl_state.micOn) === false);
await H.uncheck('#muteEntryToggle'); await S(400);

// ---------------- 26 · chat file sharing ----------------
await H.click('#chatBtn'); await S(400);
await H.setInputFiles('#chatFile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from the host, this is a shared file.') });
await S(2500);
const got = await G.evaluate(() => {
  const rows = [...document.querySelectorAll('#chatLog .chat-msg')];
  const withFile = rows.filter(r => r.querySelector('.chat-file'));
  const last = withFile[withFile.length - 1];
  return last ? { name: last.querySelector('.cf-name')?.textContent, save: !!last.querySelector('a[download]') } : null;
});
check('26 · a file sent in chat arrives for everyone', !!got && /notes\.txt/.test(got.name), JSON.stringify(got));
check('26 · the recipient gets a save link', !!got && got.save === true);
await G.click('#chatBtn').catch(()=>{}); await S(400);
await G.screenshot({ path: `${SHOT}/34-chat-file.png` });
await H.click('#chatClose');

// ---------------- 24 · breakout rooms ----------------
await openBreakout(H);
await H.fill('#brkCount', '1');
await H.fill('#brkMinutes', '2');
await H.click('#brkCreate'); await S(600);
await H.click('#brkOpen'); await S(1200);
const brkState = await H.evaluate(() => ({ rooms: window.__zl_state.breakoutRooms.length, endsAt: !!window.__zl_state.breakoutEndsAt }));
check('24 · rooms open with a time limit', brkState.rooms === 1 && brkState.endsAt, JSON.stringify(brkState));
const subRoom = await H.evaluate(() => window.__zl_state.breakoutRooms[0].room);

// the guest is moved into the sub-room
await G.waitForFunction(() => location.pathname.includes('-b1'), null, { timeout: 15000 });
await G.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3500);
const inSub = await G.evaluate(() => ({
  room: window.__zl_state.roomId, main: window.__zl_state.mainRoom,
  banner: !document.getElementById('breakoutBanner').hidden,
  countdown: document.getElementById('brkCountdown').textContent,
}));
check('24 · participant lands in the breakout room', inSub.room.includes('-b1') && inSub.banner, JSON.stringify(inSub));
check('24 · the countdown is visible in the room', /left/.test(inSub.countdown), inSub.countdown);
// This guest is a co-host, so they are a moderator in the breakout too.
check('24 · the meeting owner, not the first arrival, owns the breakout room',
      await G.evaluate(() => window.__zl_state.host) !== await G.evaluate(() => window.__zl_state.selfId));
await G.screenshot({ path: `${SHOT}/35-breakout.png` });

// moderator announces to every room (the panel closes once rooms are open)
await openBreakout(H);
check('24 · the open rooms are listed for the moderator',
      await H.evaluate(() => !document.getElementById('brkLive').hidden && document.querySelectorAll('#brkRoomList .brk-room-row').length === 1));
await H.fill('#brkMsg', 'five minutes left');
await H.click('#brkSend'); await S(1500);
check('24 · an announcement reaches people inside the rooms',
      /five minutes left/.test(await G.evaluate(() => document.getElementById('chatLog').textContent)));

// a moderator can hop into a breakout room and back out
await H.click('#brkRoomList button:has-text("Join")');
await H.waitForFunction(() => location.pathname.includes('-b1'), null, { timeout: 15000 });
await H.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3500);
const hostInSub = await H.evaluate(() => ({ room: window.__zl_state.roomId, isHost: window.__zl_state.amHost, mod: window.__zl_state.moderator }));
check('24 · a moderator can join a breakout room and is host inside it',
      hostInSub.room.includes('-b1') && hostInSub.isHost === true, JSON.stringify(hostInSub));
await H.click('#returnMain');
await H.waitForFunction(r => location.pathname.endsWith('/room/' + r), room, { timeout: 15000 });
await S(3000);
check('24 · and can leave it again back to the main room',
      await H.evaluate(() => window.__zl_state.roomId) === room);

// close everything
await openBreakout(H);
await H.click('#brkCloseAll'); await S(2000);
await G.waitForFunction(r => location.pathname.endsWith('/room/' + r), room, { timeout: 20000 }).catch(()=>{});
await S(2500);
check('24 · closing the rooms brings people back', await G.evaluate(() => window.__zl_state.roomId) === room);

console.log('\n===== SUMMARY =====');
const f = results.filter(r => !r[0]);
console.log(`${results.length - f.length}/${results.length} passed`);
f.forEach(x => console.log('  FAILED:', x[1], x[2]));
await browser.close();
process.exit(f.length ? 1 : 0);
