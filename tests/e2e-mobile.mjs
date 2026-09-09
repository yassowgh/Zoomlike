// Mobile audit: every screen and panel at phone size.
//
// Checks that nothing overflows horizontally, that tap targets are big enough,
// that no control is covered by another element, and that the pre-join check
// can be skipped by a returning guest.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-mobile.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.ZL_BASE || 'http://127.0.0.1:8787';
const SHOT = process.env.ZL_SHOTS || new URL('./screenshots', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const results = [];
const check = (n, ok, x = '') => { results.push([ok, n, x]); console.log((ok ? 'PASS' : 'FAIL'), '·', n, x); };
const S = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { width: 390, height: 844 };          // iPhone-ish
const SMALL = { width: 320, height: 568 };          // the narrowest phone worth supporting

const browser = await chromium.launch({
  executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});
async function phone(tag, vp = PHONE) {
  const c = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await c.newPage();
  p.on('pageerror', e => console.log(`  [${tag}]`, String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') console.log(`  [${tag} err]`, m.text().slice(0, 160)); });
  return p;
}

// Does the page scroll sideways, and does anything stick out past the viewport?
// Content inside a deliberately horizontal scroller (the participant strip) is
// meant to extend past the edge, so it is not an offender.
const overflow = p => p.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const inScroller = (e) => {
    for (let n = e.parentElement; n; n = n.parentElement) {
      const ov = getComputedStyle(n).overflowX;
      if (ov === 'auto' || ov === 'scroll') return true;
    }
    return false;
  };
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.offsetParent === null && e.tagName !== 'BODY') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (inScroller(e)) continue;
    if (r.right > w + 1 || r.left < -1) bad.push(`${e.tagName}#${e.id || ''}.${(e.className || '').toString().split(' ')[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: w, offenders: bad.slice(0, 6) };
});

// Anything you are meant to tap should be a reasonable size and not covered.
// When a panel or modal is open it IS the interaction surface and covering the
// room behind it is the point, so only its own controls are audited.
const tapAudit = p => p.evaluate(() => {
  const small = [], covered = [];
  const overlay = [...document.querySelectorAll('.side-panel, .modal')]
    .find((e) => !e.hidden && e.offsetParent !== null);
  const scope = overlay || document;
  for (const b of scope.querySelectorAll('button, select, input[type=checkbox], a[download]')) {
    if (b.offsetParent === null) continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const id = b.id || b.textContent.trim().slice(0, 18) || b.tagName;
    // A checkbox wrapped in a label is tapped by the whole label, so that is
    // the real target, not the 20px box the browser draws.
    const label = b.closest('label');
    const target = label ? label.getBoundingClientRect() : r;
    if (target.height < 28 || target.width < 28) small.push(`${id} ${Math.round(target.width)}x${Math.round(target.height)}`);
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== b && !b.contains(hit) && !hit.contains(b)) covered.push(`${id} <- ${hit.id || hit.tagName}`);
  }
  return { small, covered };
});

const room = 'mb-' + Math.random().toString(36).slice(2, 7);

// ---------- host sets the room up from a desktop ----------
const desk = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
const H = await desk.newPage();
await H.goto(BASE, { waitUntil: 'networkidle' });
await H.click('#tabRegister');
await H.fill('#authName', 'Hosty'); await H.fill('#authEmail', `m${Date.now()}@e.com`); await H.fill('#authPassword', 'secret123');
await H.click('#authSubmit'); await H.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
await H.check('input[name="access"][value="open"]');
await H.fill('#roomInput', room); await H.click('#joinBtn');
await H.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await H.click('#pjJoin'); await H.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(2000);
// let the phone draw, so the whiteboard toolbar is meaningful
await H.click('#peopleBtn'); await S(400); await H.check('#allowDrawToggle'); await S(400); await H.click('#peopleClose');

// ---------- 1. auth screen on a phone ----------
const A = await phone('auth');
await A.goto(BASE, { waitUntil: 'networkidle' });
await S(600);
let o = await overflow(A);
check('mobile · sign-in screen does not overflow sideways', o.scrollWidth <= o.clientWidth + 1 && o.offenders.length === 0, JSON.stringify(o));
await A.screenshot({ path: `${SHOT}/40-m-auth.png`, fullPage: true });

// ---------- 2. pre-join on a phone ----------
const M = await phone('phone');
await M.goto(BASE, { waitUntil: 'networkidle' });
await M.evaluate(() => localStorage.setItem('zl_name', 'Mobi'));
await M.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await M.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await S(1500);
o = await overflow(M);
check('mobile · pre-join screen does not overflow sideways', o.scrollWidth <= o.clientWidth + 1 && o.offenders.length === 0, JSON.stringify(o));
let t = await tapAudit(M);
check('mobile · pre-join controls are big enough and reachable', t.small.length === 0 && t.covered.length === 0, JSON.stringify(t));
const pjFits = await M.evaluate(() => {
  const j = document.getElementById('pjJoin').getBoundingClientRect();
  return { joinVisible: j.top >= 0 && j.bottom <= innerHeight, docH: document.documentElement.scrollHeight, winH: innerHeight };
});
check('mobile · the Join button is reachable on a phone screen', pjFits.joinVisible || pjFits.docH > pjFits.winH, JSON.stringify(pjFits));
await M.screenshot({ path: `${SHOT}/41-m-prejoin.png`, fullPage: true });

// ---------- 3. skip the check next time ----------
await M.check('#pjSkip');
await M.click('#pjJoin');
await M.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3000);
check('mobile · joined the meeting', await M.evaluate(() => !document.getElementById('room').hidden));

// ---------- 4. the room on a phone ----------
o = await overflow(M);
check('mobile · room does not overflow sideways', o.scrollWidth <= o.clientWidth + 1 && o.offenders.length === 0, JSON.stringify(o));
t = await tapAudit(M);
check('mobile · room controls are big enough and reachable', t.small.length === 0 && t.covered.length === 0, JSON.stringify(t));
await M.screenshot({ path: `${SHOT}/42-m-room.png` });

// every panel and menu in turn
const panels = [
  ['people',   async () => { await M.click('#peopleBtn'); }],
  ['chat',     async () => { await M.click('#chatBtn'); }],
  ['view',     async () => { await M.click('#viewBtn'); }],
  ['more',     async () => { await M.click('#moreBtn'); }],
  ['devices',  async () => { await M.click('#moreBtn'); await S(250); await M.click('#devicesBtn'); }],
  ['rename',   async () => { await M.click('#moreBtn'); await S(250); await M.click('#renameBtn'); }],
  ['controls', async () => { await M.click('#moreCtrlBtn'); }],
  ['tools',    async () => { await M.click('#toolsBtn'); }],
];
for (const [name, open] of panels) {
  await M.keyboard.press('Escape').catch(() => {});
  await open(); await S(700);
  const oo = await overflow(M);
  const tt = await tapAudit(M);
  check(`mobile · ${name} fits and is usable`,
        oo.scrollWidth <= oo.clientWidth + 1 && oo.offenders.length === 0 && tt.small.length === 0 && tt.covered.length === 0,
        JSON.stringify({ overflow: oo.offenders, small: tt.small, covered: tt.covered }));
  await M.screenshot({ path: `${SHOT}/43-m-${name}.png` });
  // close whatever is open
  await M.evaluate(() => {
    for (const id of ['people','chat','breakout','devices']) { const e = document.getElementById(id); if (e) e.hidden = true; }
    for (const id of ['viewMenu','moreMenu','renameModal','recMenu','reactMenu','bgVideoMenu','bgMenu']) { const e = document.getElementById(id); if (e) e.hidden = true; }
    document.getElementById('controls')?.classList.remove('expanded');
    document.getElementById('boardWrap')?.classList.remove('tools-open');
  });
  await S(200);
}

// ---------- 5. the narrowest phone ----------
const N = await phone('small', SMALL);
await N.goto(BASE, { waitUntil: 'networkidle' });
await N.evaluate(() => localStorage.setItem('zl_name', 'Tiny'));
await N.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await N.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await N.click('#pjJoin');
await N.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3000);
o = await overflow(N);
check('mobile · 320px-wide phone does not overflow', o.scrollWidth <= o.clientWidth + 1 && o.offenders.length === 0, JSON.stringify(o));
t = await tapAudit(N);
check('mobile · 320px-wide controls are usable', t.small.length === 0 && t.covered.length === 0, JSON.stringify(t));
await N.screenshot({ path: `${SHOT}/44-m-320.png` });

// ---------- 6. returning guest skips the check ----------
await M.evaluate(() => { try { location.href = '/'; } catch {} });
await S(1200);
const R = await phone('return');
await R.goto(BASE, { waitUntil: 'networkidle' });
await R.evaluate(() => { localStorage.setItem('zl_name', 'Regular'); localStorage.setItem('zl_skip_prejoin', '1'); });
await R.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await R.waitForSelector('#room:not([hidden])', { timeout: 20000 });
await S(2500);
const straight = await R.evaluate(() => ({ inRoom: !document.getElementById('room').hidden, prejoin: !document.getElementById('prejoin').hidden, name: window.__zl_state.name }));
check('a returning guest who opted out goes straight in', straight.inRoom && !straight.prejoin && straight.name === 'Regular', JSON.stringify(straight));

// and can turn the check back on from inside the meeting
await R.click('#moreBtn'); await S(300);
await R.click('#devicesBtn'); await S(700);
const toggleState = await R.evaluate(() => document.getElementById('prejoinToggle').checked);
check('the meeting offers a way to turn the check back on', toggleState === false, `checkbox=${toggleState}`);
await R.check('#prejoinToggle'); await S(400);
check('turning it back on clears the preference', await R.evaluate(() => localStorage.getItem('zl_skip_prejoin')) === null);
await R.screenshot({ path: `${SHOT}/45-m-devices.png` });

console.log('\n===== SUMMARY =====');
const f = results.filter(r => !r[0]);
console.log(`${results.length - f.length}/${results.length} passed`);
f.forEach(x => console.log('  FAILED:', x[1], x[2]));
await browser.close();
process.exit(f.length ? 1 : 0);
