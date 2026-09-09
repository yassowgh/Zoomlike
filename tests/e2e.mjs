// End-to-end smoke test for the whole meeting flow.
//
// Start a local worker first, then run this against it:
//   npx wrangler dev --port 8787 --local
//   npm run test:e2e
//
// Chromium comes from PLAYWRIGHT_BROWSERS_PATH; override with ZL_CHROMIUM.
// Screenshots land in tests/screenshots (override with ZL_SHOTS).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const BASE = process.env.ZL_BASE || 'http://127.0.0.1:8787';
const SHOT = process.env.ZL_SHOTS || new URL('./screenshots', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const results = [];
const check = (n, ok, extra='') => { results.push([ok,n,extra]); console.log((ok?'PASS':'FAIL'),'·',n,extra); };

const browser = await chromium.launch({
  executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'],
});
async function ctx(name, vp) {
  const c = await browser.newContext({ permissions:['camera','microphone'], viewport: vp||{width:1280,height:800}, ...(vp?{isMobile:true,hasTouch:true}:{}) });
  const p = await c.newPage();
  p.on('pageerror', e => console.log(`  [${name} pageerror]`, String(e).slice(0,200)));
  p.on('console', m => { if (m.type()==='error') console.log(`  [${name} err]`, m.text().slice(0,160)); });
  return p;
}
const S = ms => new Promise(r=>setTimeout(r,ms));

const room = 'zt-' + Math.random().toString(36).slice(2,7);
const hostEmail = `h${Date.now()}@example.com`;

// ---------- HOST creates an OPEN-ACCESS room (item 13) ----------
const H = await ctx('host');
await H.goto(BASE, { waitUntil:'networkidle' });
await H.click('#tabRegister');
await H.fill('#authName','Hosty'); await H.fill('#authEmail',hostEmail); await H.fill('#authPassword','secret123');
await H.click('#authSubmit');
await H.waitForSelector('#lobby:not([hidden])',{timeout:15000});
const accessVisible = await H.evaluate(()=>!!document.querySelector('.access-field') && !document.querySelector('.access-field').hidden);
check('13 · access chooser shown when creating a meeting', accessVisible);
await H.screenshot({path:`${SHOT}/01-lobby-access.png`});
await H.check('input[name="access"][value="open"]');
await H.fill('#roomInput', room);
await H.click('#joinBtn');
await H.waitForSelector('#room:not([hidden])',{timeout:15000});
await H.waitForFunction(()=>document.getElementById('connState')?.textContent.includes('connected'),null,{timeout:15000});
await S(800);
check('host in room', true);

// ---------- GUEST opens the invite link (item 12) ----------
const G = await ctx('guest');
await G.goto(`${BASE}/room/${room}`, { waitUntil:'networkidle' });
await S(700);
const sawQuickJoin = await G.evaluate(()=>!document.getElementById('quickJoin').hidden);
const sawAuth = await G.evaluate(()=>!document.getElementById('auth').hidden);
check('12 · invite link shows name-only quick join, not login/register', sawQuickJoin && !sawAuth, `quickJoin=${sawQuickJoin} auth=${sawAuth}`);
await G.screenshot({path:`${SHOT}/02-quickjoin.png`});
await G.fill('#qjName','Guesty');
await G.click('#qjSubmit');
await G.waitForSelector('#room:not([hidden])',{timeout:15000});
await S(1200);
const guestWaiting = await G.evaluate(()=>!document.getElementById('waitingScreen').hidden);
check('13 · open access lets the guest in with no approval', !guestWaiting, guestWaiting?'was held in waiting room':'');
await S(2500);
check('peers connected', await H.evaluate(()=>document.querySelectorAll('#videos .tile').length)===2);

// ---------- 12b: second visit needs no prompt at all ----------
const G2 = await ctx('guest2');
await G2.evaluate(()=>{}).catch(()=>{});
await G2.goto(BASE,{waitUntil:'networkidle'});
await G2.evaluate(()=>localStorage.setItem('zl_name','Returning'));
await G2.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await S(2500);
const autoJoined = await G2.evaluate(()=>!document.getElementById('room').hidden);
check('12 · a remembered name joins with no prompt at all', autoJoined);

// ---------- item 5: only one hand in the UI ----------
const hands = await H.evaluate(()=>{
  const hits = [...document.querySelectorAll('#room button')]
    .filter(b => /✋|🖐|🤚/.test(b.textContent))
    .map(b => b.id || b.className);
  return hits;
});
check('5 · exactly one hand control in the room UI', hands.length===1 && hands[0]==='handBtn', `hand buttons = ${JSON.stringify(hands)}`);

// ---------- item 6: host board colour reaches everyone ----------
await H.click('#moreBtn'); await S(250);
await H.click('#bgBtn'); await S(300);
await H.click('.bg-swatch[data-bg="white"]'); await S(900);
const guestBg = await G.evaluate(()=>document.getElementById('boardWrap').dataset.bg);
check('6 · host board background applied for the guest', guestBg==='white', `guest bg = ${guestBg}`);
const guestCanChangeBg = await G.evaluate(()=>!document.getElementById('bgBtn').hidden);
check('6 · non-host cannot change the shared background', !guestCanChangeBg);
await G.screenshot({path:`${SHOT}/03-guest-bg-white.png`});

// ---------- item 3: whiteboard on/off ----------
await H.click('#moreBtn'); await S(250);
await H.click('#boardToggleBtn'); await S(900);
const guestBoardHidden = await G.evaluate(()=>document.getElementById('boardWrap').hidden);
const guestLayout = await G.evaluate(()=>document.getElementById('room').dataset.layout);
check('3 · host turning the whiteboard off hides it for the guest', guestBoardHidden, `guest layout=${guestLayout}`);
await G.screenshot({path:`${SHOT}/04-guest-board-off.png`});
await H.click('#moreBtn'); await S(250);
await H.click('#boardToggleBtn'); await S(900);
const guestBoardBack = await G.evaluate(()=>!document.getElementById('boardWrap').hidden);
check('3 · turning it back on restores the whiteboard', guestBoardBack);

// ---------- item 7: layouts ----------
await H.click('#viewBtn'); await S(250);
await H.click('#viewMenu [data-view="gallery"]'); await S(600);
check('7 · gallery layout applies', await H.evaluate(()=>document.getElementById('room').dataset.layout)==='gallery');
await H.screenshot({path:`${SHOT}/05-gallery.png`});
await H.click('#viewBtn'); await S(250);
await H.click('#viewMenu [data-view="speaker"]'); await S(600);
const speakerOn = await H.evaluate(()=>!document.getElementById('spotStage').hidden);
check('7 · speaker layout shows the big stage', speakerOn);
await H.click('#viewBtn'); await S(250);
await H.click('#viewMenu [data-strip="bottom"]'); await S(600);
check('7 · participant strip can move to the bottom', await H.evaluate(()=>document.getElementById('room').dataset.strip)==='bottom');
await H.screenshot({path:`${SHOT}/06-speaker-bottom.png`});
// persistence across reload
await H.reload({waitUntil:'networkidle'}); await S(3000);
const persisted = await H.evaluate(()=>({l:document.getElementById('room').dataset.layout,s:document.getElementById('room').dataset.strip}));
check('7 · layout choice survives a reload', persisted.l==='speaker'&&persisted.s==='bottom', JSON.stringify(persisted));

// ---------- item 11: spotlight ----------
await H.click('#peopleBtn'); await S(500);
const spotBtn = await H.$('#peopleList button:has-text("Spotlight")');
check('11 · host sees a spotlight action', !!spotBtn);
if (spotBtn) await spotBtn.click();
await S(1200);
const guestSpot = await G.evaluate(()=>({spot:window.__zl_state.spotlight, stage:!document.getElementById('spotStage').hidden, tag:!document.getElementById('spotTag').hidden}));
check('11 · spotlight pushes every viewer to the speaker stage', guestSpot.stage && !!guestSpot.spot && guestSpot.tag, JSON.stringify(guestSpot));
await G.screenshot({path:`${SHOT}/07-guest-spotlight.png`});

// ---------- item 9: share request ----------
await G.click('#shareBtn'); await S(1000);
const hostSawShareReq = await H.evaluate(()=>document.getElementById('requestList').textContent);
check('9 · share request reaches the host', /share/i.test(hostSawShareReq), JSON.stringify(hostSawShareReq.slice(0,70)));
await H.screenshot({path:`${SHOT}/08-host-requests.png`});
const allowBtn = await H.$('#requestList button:has-text("Allow")');
if (allowBtn) await allowBtn.click();
await S(900);
check('9 · approval grants the guest share permission', await G.evaluate(()=>window.__zl_state.canShare)===true);

// ---------- item 8: record request ----------
await G.click('#recBtn'); await S(1000);
const hostSawRecReq = await H.evaluate(()=>document.getElementById('requestList').textContent);
check('8 · record request reaches the host', /record/i.test(hostSawRecReq), JSON.stringify(hostSawRecReq.slice(0,70)));
const guestRecordingYet = await G.evaluate(()=>window.__zl_state.recorder?.recording===true);
check('8 · guest is not recording while waiting for approval', !guestRecordingYet);
const denyBtn = await H.$('#requestList button:has-text("Deny")');
if (denyBtn) await denyBtn.click();
await S(900);
check('8 · denial leaves the guest without record permission', await G.evaluate(()=>window.__zl_state.canRecord)===false);
// host records without asking
const hostCanRecord = await H.evaluate(()=>window.__zl_state.canRecord===true);
check('8 · host may record without asking anyone', hostCanRecord);

// ---------- item 10: mute / mute all / remove ----------
await H.click('#peopleBtn').catch(()=>{}); await S(400);
if (await H.evaluate(()=>document.getElementById('people').hidden)) { await H.click('#peopleBtn'); await S(400); }
await G.evaluate(()=>{ window.__zl_state.micOn = true; });
const gid = await G.evaluate(()=>window.__zl_state.selfId);
const muteOne = await H.$(`#peopleList .prow[data-pid="${gid}"] button:has-text("Mute")`);
check('10 · host sees a mute action for that person', !!muteOne);
if (muteOne) await muteOne.click();
await S(900);
check('10 · host can mute one person', await G.evaluate(()=>window.__zl_state.micOn)===false);
await G.evaluate(()=>{ window.__zl_state.micOn = true; });
await H.click('#muteAllBtn'); await S(900);
check('10 · host can mute everyone', await G.evaluate(()=>window.__zl_state.micOn)===false);
G.on('dialog', d=>d.accept());
H.on('dialog', d=>d.accept());
const rmBtn = await H.$('#peopleList button:has-text("Remove")');
check('10 · host has a remove action', !!rmBtn);

// ---------- 11b: removing the spotlight restores each viewer's own layout ----
const guestPrefBefore = await G.evaluate(()=>window.__zl_state.layout);
if (await H.evaluate(()=>document.getElementById('people').hidden)) { await H.click('#peopleBtn'); await S(400); }
const unspot = await H.$('#peopleList button:has-text("Unspotlight")');
check('11 · host can remove the spotlight', !!unspot);
if (unspot) await unspot.click();
await S(1200);
const guestAfter = await G.evaluate(()=>({eff:document.getElementById('room').dataset.layout, pref:window.__zl_state.layout, spot:window.__zl_state.spotlight}));
check('11 · clearing the spotlight returns the viewer to their own layout',
      !guestAfter.spot && guestAfter.eff===guestPrefBefore, `pref=${guestPrefBefore} -> ${JSON.stringify(guestAfter)}`);

// ---------- item 4: mobile ----------
const M = await ctx('mobile', {width:390,height:844});
await M.evaluate(()=>{}).catch(()=>{});
await M.goto(BASE,{waitUntil:'networkidle'});
await M.evaluate(()=>localStorage.setItem('zl_name','Mobi'));
await M.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await S(3500);
const mob = await M.evaluate(()=>{
  const vis = e => e && e.offsetParent !== null;
  const ctrls = [...document.querySelectorAll('#controls .ctrl-item')];
  return {
    visibleControls: ctrls.filter(vis).length,
    totalControls: ctrls.length,
    toolbarVisible: vis(document.getElementById('toolbar')),
    toolsBtnVisible: vis(document.getElementById('toolsBtn')),
    bodyOverflows: document.documentElement.scrollWidth > window.innerWidth + 1,
    boardOn: window.__zl_state?.boardOn, layout: document.getElementById('room').dataset.layout,
    boardHidden: document.getElementById('boardWrap').hidden,
  };
});
check('4 · phone shows a reduced control set, not everything', mob.visibleControls < mob.totalControls, JSON.stringify(mob));
check('4 · drawing tools are hidden behind the toolbox button', !mob.toolbarVisible && mob.toolsBtnVisible);
check('4 · no horizontal overflow on a phone', !mob.bodyOverflows);
await M.screenshot({path:`${SHOT}/09-mobile-clean.png`});
await M.click('#moreCtrlBtn'); await S(500);
const mobExpanded = await M.evaluate(()=>[...document.querySelectorAll('#controls .ctrl-item')].filter(e=>e.offsetParent!==null).length);
check('4 · "More" reveals the rest of the controls', mobExpanded > mob.visibleControls, `${mob.visibleControls} -> ${mobExpanded}`);
await M.screenshot({path:`${SHOT}/10-mobile-more.png`});
await M.click('#toolsBtn'); await S(400);
await M.screenshot({path:`${SHOT}/11-mobile-tools.png`});

// ---------- item 2: end + reset ----------
// draw something first so we can prove the board is wiped
await H.click('#viewBtn'); await S(200); await H.click('#viewMenu [data-view="board"]'); await S(600);
const bb = await H.evaluate(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return{x:r.x,y:r.y};});
await H.mouse.move(bb.x+200,bb.y+200); await H.mouse.down();
await H.mouse.move(bb.x+330,bb.y+280,{steps:10}); await H.mouse.up();
await S(1000);
check('board still syncs after all the changes', await G.evaluate(()=>window.__zl_state.board.objects.size)>0);
await H.click('#peopleBtn').catch(()=>{}); await S(300);
if (await H.evaluate(()=>document.getElementById('people').hidden)) { await H.click('#peopleBtn'); await S(300); }
await H.click('#endMeetingBtn'); await S(2500);
const guestEnded = await G.evaluate(()=>!document.getElementById('endedModal').hidden);
check('2 · guest is told the meeting ended', guestEnded);
await G.screenshot({path:`${SHOT}/12-ended.png`});

const R = await ctx('rejoin');
await R.goto(BASE,{waitUntil:'networkidle'});
await R.evaluate(t=>localStorage.setItem('zl_token',t), await H.evaluate(()=>localStorage.getItem('zl_token')));
await R.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await S(4000);
const after = await R.evaluate(()=>({
  shapes: window.__zl_state?.board?.objects?.size ?? -1,
  bg: document.getElementById('boardWrap').dataset.bg,
  boardOn: window.__zl_state?.boardOn,
  spotlight: window.__zl_state?.spotlight,
}));
check('2 · board is wiped for the next meeting', after.shapes===0, `shapes=${after.shapes}`);
check('2 · board background reset to default', after.bg==='dark', `bg=${after.bg}`);
check('2 · whiteboard re-enabled and spotlight cleared', after.boardOn===true && !after.spotlight, JSON.stringify(after));
await R.screenshot({path:`${SHOT}/13-fresh-room.png`});

console.log('\n===== SUMMARY =====');
const fails = results.filter(r=>!r[0]);
console.log(`${results.length-fails.length}/${results.length} passed`);
fails.forEach(f=>console.log('  FAILED:',f[1],f[2]));
await browser.close();
process.exit(fails.length?1:0);
