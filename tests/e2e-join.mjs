// Meeting defaults and join order: the whiteboard starts off, the default
// view is the gallery, an invite link will not open a meeting the host has
// not started, and an invitee cannot retarget the room.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-join.mjs
import { chromium } from 'playwright';
const BASE=process.env.ZL_BASE||'http://127.0.0.1:8787';
const SHOT=process.env.ZL_SHOTS||new URL('./screenshots',import.meta.url).pathname;
import {mkdirSync} from 'node:fs'; mkdirSync(SHOT,{recursive:true});
const S=ms=>new Promise(r=>setTimeout(r,ms));
const R=[]; const check=(n,ok,x='')=>{R.push([ok,n,x]);console.log((ok?'PASS':'FAIL'),'·',n,x);};
const b=await chromium.launch({executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
const mk=async(t,vp,m)=>{const c=await b.newContext({permissions:['camera','microphone'],viewport:vp||{width:1280,height:900},...(m?{isMobile:true,hasTouch:true}:{})});const p=await c.newPage();p.on('pageerror',e=>console.log(`[${t}]`,String(e).slice(0,160)));return p;};
const room='nf-'+Math.random().toString(36).slice(2,7);

// --- guest hits the link BEFORE the host opens the meeting ---
const G=await mk('guest');
await G.goto(BASE,{waitUntil:'networkidle'});
await G.evaluate(()=>localStorage.setItem('zl_name','Sally'));
await G.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await G.waitForSelector('#prejoin:not([hidden])',{timeout:15000});
await G.click('#pjJoin'); await S(3000);
const held=await G.evaluate(()=>({notStarted:!document.getElementById('notStarted').hidden, inRoom:!document.getElementById('room').hidden}));
check('an invite link does not open an unopened meeting', held.notStarted, JSON.stringify(held));

// --- host opens it; the waiting guest goes in automatically ---
const H=await mk('host');
await H.goto(BASE,{waitUntil:'networkidle'});
await H.click('#tabRegister');
await H.fill('#authName','Hosty');await H.fill('#authEmail',`n${Date.now()}@e.com`);await H.fill('#authPassword','secret123');
await H.click('#authSubmit');await H.waitForSelector('#lobby:not([hidden])',{timeout:15000});
await H.check('input[name="access"][value="open"]');
await H.fill('#roomInput',room);await H.click('#joinBtn');
await H.waitForSelector('#prejoin:not([hidden])',{timeout:15000});await H.click('#pjJoin');
await H.waitForSelector('#room:not([hidden])',{timeout:15000});await S(4000);
const after=await G.evaluate(()=>({notStarted:!document.getElementById('notStarted').hidden, inRoom:!document.getElementById('room').hidden}));
check('and lets them in as soon as the host opens it', !after.notStarted && after.inRoom, JSON.stringify(after));

// --- defaults ---
const d=await H.evaluate(()=>({
  boardOn: window.__zl_state.boardOn,
  layout: document.getElementById('room').dataset.layout,
  bg: document.getElementById('boardWrap').dataset.bg,
  boardHidden: document.getElementById('boardWrap').hidden,
}));
check('the whiteboard starts off', d.boardOn===false, JSON.stringify(d));
check('the default view is gallery', d.layout==='gallery');
check('the board background defaults to white', d.bg==='white');

// --- drawing tools hidden without permission ---
const g=await G.evaluate(()=>{const v=e=>e&&e.offsetParent!==null;return{
  canDraw: window.__zl_state.canDraw,
  toolbar: v(document.getElementById('toolbar')),
  toolsBtn: v(document.getElementById('toolsBtn')),
};});
check('a participant with no draw permission sees no tools', g.canDraw===false && !g.toolbar && !g.toolsBtn, JSON.stringify(g));

// --- gallery is not cropped ---
const fit=await H.evaluate(()=>getComputedStyle(document.querySelector('#videos .tile video')).objectFit);
check('gallery tiles show the whole frame', fit==='contain', fit);

// --- invitee cannot retarget the room ---
const lock=await G.evaluate(()=>({ro:document.getElementById('roomInput').readOnly, dice:document.getElementById('randomRoomBtn').hidden}));
check('an invitee cannot edit the room name', lock.ro===true && lock.dice===true, JSON.stringify(lock));

// --- prejoin card does not overflow with long device names ---
const P=await mk('prejoin',{width:1400,height:900});
await P.goto(BASE,{waitUntil:'networkidle'});
await P.evaluate(()=>localStorage.setItem('zl_name','Wide'));
await P.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await P.waitForSelector('#prejoin:not([hidden])',{timeout:15000});await S(1200);
const ov=await P.evaluate(()=>{
  const card=document.querySelector('.prejoin-card').getBoundingClientRect();
  const bad=[...document.querySelectorAll('.prejoin-side *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>card.right+1;}).map(e=>e.id||e.tagName);
  return {cardW:Math.round(card.width), overflowing:bad};
});
check('nothing overflows the pre-join card', ov.overflowing.length===0, JSON.stringify(ov));
await P.screenshot({path:SHOT+'/60-prejoin-wide.png'});

// --- mobile chat does not summon the keyboard ---
const M=await mk('phone',{width:390,height:844},true);
await M.goto(BASE,{waitUntil:'networkidle'});
await M.evaluate(()=>localStorage.setItem('zl_name','Mobi'));
await M.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await M.waitForSelector('#prejoin:not([hidden])',{timeout:15000});await M.click('#pjJoin');
await M.waitForSelector('#room:not([hidden])',{timeout:15000});await S(2500);
await M.click('#chatBtn'); await S(700);
const focused=await M.evaluate(()=>({open:!document.getElementById('chat').hidden, focused:document.activeElement?.id||''}));
check('opening chat on a phone does not focus the input', focused.open && focused.focused!=='chatInput', JSON.stringify(focused));
await M.click('#chatInput'); await S(400);
check('tapping the field does focus it', await M.evaluate(()=>document.activeElement?.id)==='chatInput');
await M.screenshot({path:SHOT+'/61-mobile-chat.png'});

console.log('\n===== SUMMARY =====');
const f=R.filter(r=>!r[0]);
console.log(`${R.length-f.length}/${R.length} passed`);
f.forEach(x=>console.log('  FAILED:',x[1],x[2]));
await b.close();

process.exit(R.filter(r=>!r[0]).length?1:0);
