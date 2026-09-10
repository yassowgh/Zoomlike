// Regressions for problems found in a real multi-person call:
// text too small to read, text not resizable, participant names invisible
// behind their action buttons, chat covering the gallery, landscape phones
// getting the desktop whiteboard, and guests with no name.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-fixes.mjs
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
async function mk(tag, vp, mobile) {
  const c = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: vp || { width: 1280, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const p = await c.newPage();
  p.on('pageerror', e => console.log(`  [${tag}]`, String(e).slice(0, 180)));
  return p;
}
const room = 'fx-' + Math.random().toString(36).slice(2, 7);
const H = await mk('host');
await H.goto(BASE, { waitUntil: 'networkidle' });
await H.click('#tabRegister');
await H.fill('#authName', 'Hosty'); await H.fill('#authEmail', `f${Date.now()}@e.com`); await H.fill('#authPassword', 'secret123');
await H.click('#authSubmit'); await H.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
await H.check('input[name="access"][value="open"]');
await H.fill('#roomInput', room); await H.click('#joinBtn');
await H.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await H.click('#pjJoin'); await H.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(2000);

// ---------- whiteboard text is readable by default, and resizable ----------
// Meetings open in the gallery with the whiteboard off, so switch both on.
await H.click('#moreBtn'); await S(300);
await H.click('#boardToggleBtn'); await S(900);
await H.click('#viewBtn'); await S(300);
await H.click('#viewMenu [data-view="board"]'); await S(800);
check('the board background defaults to white',
      await H.evaluate(() => document.getElementById('boardWrap').dataset.bg) === 'white');
check('text size control defaults to 12', await H.evaluate(() => document.getElementById('textSizePick').value) === '12');
await H.click('#toolbar .tool[data-tool="text"]'); await S(300);
const box = await H.evaluate(() => { const r = document.getElementById('overlay').getBoundingClientRect(); return { x: r.x, y: r.y }; });
await H.mouse.click(box.x + 260, box.y + 220); await S(500);
await H.keyboard.type('Readable?');
await H.keyboard.press('Enter'); await S(800);
const txt = await H.evaluate(() => {
  const o = [...window.__zl_state.board.objects.values()].find(o => o.type === 'text');
  return o ? { size: o.size, w: Math.round(o.w), text: o.text } : null;
});
check('typed text is created at a readable size, not the stroke width',
      !!txt && txt.size === 12, JSON.stringify(txt));
check('text is measured at its real size', !!txt && txt.w > 30, `width=${txt?.w}`);

// resize it by dragging the corner handle
await H.click('#toolbar .tool[data-tool="select"]'); await S(200);
await H.mouse.click(box.x + 270, box.y + 225); await S(400);
const before = await H.evaluate(() => [...window.__zl_state.board.objects.values()].find(o => o.type === 'text').size);
const handle = await H.evaluate(() => {
  const wb = window.__zl_state.board;
  const o = [...wb.objects.values()].find(o => o.type === 'text');
  const [sx, sy] = wb.toScreen(o.x + o.w, o.y + o.h);
  const r = document.getElementById('overlay').getBoundingClientRect();
  return { x: r.x + sx / wb.dpr, y: r.y + sy / wb.dpr };
});
await H.mouse.move(handle.x, handle.y);
await H.mouse.down();
await H.mouse.move(handle.x + 160, handle.y + 60, { steps: 12 });
await H.mouse.up(); await S(700);
const after = await H.evaluate(() => [...window.__zl_state.board.objects.values()].find(o => o.type === 'text').size);
check('dragging the corner resizes the text', after > before, `${before} -> ${after}`);
await H.screenshot({ path: `${SHOT}/50-text.png` });

// ---------- a guest must give a real name ----------
const api = await H.evaluate(async () => {
  const out = {};
  for (const n of ['', ' ', 'Guest', 'guests', 'Al']) {
    const r = await fetch('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) });
    out[JSON.stringify(n)] = r.status;
  }
  return out;
});
check('empty, blank and "Guest" names are refused; a real one is accepted',
      api['""'] === 400 && api['" "'] === 400 && api['"Guest"'] === 400 && api['"guests"'] === 400 && api['"Al"'] === 200,
      JSON.stringify(api));

// ---------- participant names are visible next to their actions ----------
const G = await mk('guest');
await G.goto(BASE, { waitUntil: 'networkidle' });
await G.evaluate(() => localStorage.setItem('zl_name', 'Sally'));
await G.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await G.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await G.click('#pjJoin'); await G.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3000);
await H.click('#peopleBtn'); await S(600);
const gid = await G.evaluate(() => window.__zl_state.selfId);
const nameBox = await H.evaluate((id) => {
  const row = document.querySelector(`#peopleList .prow[data-pid="${id}"]`);
  if (!row) return null;
  const nm = row.querySelector('.pname');
  const r = nm.getBoundingClientRect();
  return { text: nm.textContent, w: Math.round(r.width), visible: r.width > 40, buttons: row.querySelectorAll('.pact').length };
}, gid);
check('a participant name is readable alongside all their action buttons',
      !!nameBox && nameBox.text === 'Sally' && nameBox.visible, JSON.stringify(nameBox));
check('and their actions are still there', !!nameBox && nameBox.buttons >= 3, `${nameBox?.buttons} buttons`);
await H.screenshot({ path: `${SHOT}/51-people.png` });

// ---------- chat shrinks the stage rather than covering it ----------
// Close the participants panel first, or the baseline is already narrowed.
await H.click('#peopleClose'); await S(400);
await H.click('#viewBtn'); await S(250);
await H.click('#viewMenu [data-view="gallery"]'); await S(500);
const wide = await H.evaluate(() => document.querySelector('.stage').getBoundingClientRect().width);
const galleryBefore = await H.evaluate(() => document.getElementById('videos').getBoundingClientRect().right);
await H.click('#chatBtn'); await S(800);
const withChat = await H.evaluate(() => {
  const panel = document.getElementById('chat').getBoundingClientRect();
  const vids = document.getElementById('videos').getBoundingClientRect();
  return { panelLeft: Math.round(panel.left), videosRight: Math.round(vids.right), overlap: vids.right > panel.left + 1 };
});
check('opening chat does not cover the participants', !withChat.overlap, JSON.stringify(withChat));
// The stage keeps its box and gives up padding, so measure the content the
// viewer actually sees rather than the element's own width.
check('the participants area gives up the width instead of being covered',
      withChat.videosRight < galleryBefore - 100,
      `videos right edge ${Math.round(galleryBefore)} -> ${withChat.videosRight} (stage box ${Math.round(wide)})`);
await H.screenshot({ path: `${SHOT}/52-chat-gallery.png` });

// the chat recipient dropdown must not rely on a native dark-on-dark arrow
const arrow = await H.evaluate(() => {
  const st = getComputedStyle(document.getElementById('chatTo'));
  return { appearance: st.appearance || st.webkitAppearance, image: st.backgroundImage.slice(0, 30) };
});
check('the chat dropdown draws its own arrow', arrow.appearance === 'none' && arrow.image.includes('svg'), JSON.stringify(arrow));

// ---------- a phone held sideways still gets the phone layout ----------
const L = await mk('landscape', { width: 844, height: 390 }, true);
await L.goto(BASE, { waitUntil: 'networkidle' });
await L.evaluate(() => localStorage.setItem('zl_name', 'Sideways'));
await L.goto(`${BASE}/room/${room}`, { waitUntil: 'networkidle' });
await L.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await L.click('#pjJoin'); await L.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(2500);
const land = await L.evaluate(() => {
  const vis = e => e && e.offsetParent !== null;
  const btxt = document.querySelector('.btxt');
  return {
    toolbar: vis(document.getElementById('toolbar')),
    more: vis(document.getElementById('moreCtrlBtn')),          // phone-only control
    labelsHidden: btxt ? getComputedStyle(btxt).display === 'none' : null, // phone-only rule
    hiddenControls: [...document.querySelectorAll('#controls .ctrl-item[data-pri="2"]')]
      .filter(e => e.offsetParent === null).length,
  };
});
// The toolbox button depends on draw permission and the board being on, which
// is not what this is testing; the phone-only rules are.
check('a landscape phone keeps the phone layout, not the desktop one',
      !land.toolbar && land.more && land.labelsHidden === true && land.hiddenControls > 0,
      JSON.stringify(land));
await L.screenshot({ path: `${SHOT}/53-landscape.png` });

console.log('\n===== SUMMARY =====');
const f = results.filter(r => !r[0]);
console.log(`${results.length - f.length}/${results.length} passed`);
f.forEach(x => console.log('  FAILED:', x[1], x[2]));
await browser.close();
process.exit(f.length ? 1 : 0);
