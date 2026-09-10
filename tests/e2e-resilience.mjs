// Staying in the call, and fitting on a phone held sideways.
//
// Reported from a real call: minimising the browser left people still able to
// hear everyone while the room showed them as gone; the roster flickered
// people out who were still there; the meeting clock read six hours in an
// empty room; and landscape was unusably small.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-resilience.mjs
import { chromium } from 'playwright';
const BASE=process.env.ZL_BASE||'http://127.0.0.1:8787';
const S=ms=>new Promise(r=>setTimeout(r,ms));
const R=[]; const check=(n,ok,x='')=>{R.push([ok,n,x]);console.log((ok?'PASS':'FAIL'),'·',n,x);};
const b=await chromium.launch({executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
const mk=async(t,vp,m)=>{const c=await b.newContext({permissions:['camera','microphone'],viewport:vp||{width:1280,height:900},...(m?{isMobile:true,hasTouch:true}:{})});const p=await c.newPage();p.on('pageerror',e=>console.log(`[${t}]`,String(e).slice(0,160)));return p;};
const host=async(p,room)=>{
  await p.goto(BASE,{waitUntil:'networkidle'});
  await p.click('#tabRegister');
  await p.fill('#authName','Hosty');await p.fill('#authEmail',`r${Date.now()}${Math.random().toString(36).slice(2,5)}@e.com`);await p.fill('#authPassword','secret123');
  await p.click('#authSubmit');await p.waitForSelector('#lobby:not([hidden])',{timeout:15000});
  await p.check('input[name="access"][value="open"]');
  await p.fill('#roomInput',room);await p.click('#joinBtn');
  await p.waitForSelector('#prejoin:not([hidden])',{timeout:15000});await p.click('#pjJoin');
  await p.waitForSelector('#room:not([hidden])',{timeout:20000});
};

// ================= a dropped socket comes back as the same person ==========
const room='res-'+Math.random().toString(36).slice(2,7);
const H=await mk('host'); await host(H,room);
const C=await mk('caller');
await C.goto(BASE,{waitUntil:'networkidle'});
await C.evaluate(()=>localStorage.setItem('zl_name','Connie'));
await C.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});
await C.waitForSelector('#prejoin:not([hidden])',{timeout:15000});await C.click('#pjJoin');
await C.waitForSelector('#room:not([hidden])',{timeout:20000});
await S(3000);

const before=await C.evaluate(()=>({id:window.__zl_state.selfId,cid:window.__zl_state.sig.cid}));
const hBefore=await H.evaluate(()=>[...window.__zl_state.peers.keys()]);
check('the caller is in the host roster to begin with', hBefore.length===1 && hBefore[0]===before.id, JSON.stringify({hBefore,before}));
check('every socket carries a stable client id', !!before.cid && before.cid.length>4, before.cid);

// kill the socket the way a slept phone does — without a clean goodbye
await C.evaluate(()=>window.__zl_state.sig.ws.close());
await S(6000);
const after=await C.evaluate(()=>({id:window.__zl_state.selfId,open:window.__zl_state.sig.ws.readyState===1}));
check('the client reconnects on its own', after.open===true, JSON.stringify(after));
check('and comes back as the same participant, not a new one', after.id===before.id, JSON.stringify({before:before.id,after:after.id}));

const hAfter=await H.evaluate(()=>({ids:[...window.__zl_state.peers.keys()],tiles:[...window.__zl_state.tiles.keys()]}));
check('the room keeps one entry for them, with no ghost left behind',
      hAfter.ids.length===1 && hAfter.ids[0]===before.id, JSON.stringify(hAfter));
check('and no duplicate tile appears', hAfter.tiles.filter(t=>t!=='self').length===1, JSON.stringify(hAfter.tiles));

// the reconnect must not have sent them back to a waiting room either
const inRoom=await C.evaluate(()=>({room:!document.getElementById('room').hidden,waiting:!document.getElementById('waitingScreen').hidden}));
check('a readmitted reconnect is not parked in the waiting room', inRoom.room && !inRoom.waiting, JSON.stringify(inRoom));

// ================= the clock does not run in an empty room =================
const croom='clk-'+Math.random().toString(36).slice(2,7);
const A=await mk('first'); await host(A,croom);
await S(2500);
const startedA=await A.evaluate(()=>window.__zl_state.startedAt);
await A.evaluate(()=>window.__zl_state.sig.close());
await A.close();
await S(2500);
const B=await mk('second'); await host(B,croom);
await S(1500);
const startedB=await B.evaluate(()=>window.__zl_state.startedAt);
check('an empty room forgets when its meeting started', startedB>startedA, JSON.stringify({startedA,startedB}));
check('so the clock restarts instead of counting the empty hours',
      Date.now()-startedB < 20000, String(Date.now()-startedB));

// ================= the phone, both ways up =================================
const shape=async(p)=>p.evaluate(()=>{
  const q=s=>document.querySelector(s);
  const r=e=>{const b=e.getBoundingClientRect();return{t:Math.round(b.top),h:Math.round(b.height),w:Math.round(b.width),bot:Math.round(b.bottom)};};
  const vids=q('#videos');
  return {
    vh:innerHeight, stage:r(q('.stage')), videos:r(vids), controls:r(q('#controls')),
    tile:q('#videos .tile')?r(q('#videos .tile')):null,
    controlsOnScreen: q('#controls').getBoundingClientRect().bottom <= innerHeight+1,
    tilesFit: [...document.querySelectorAll('#videos .tile')].every(t=>t.getBoundingClientRect().bottom <= vids.getBoundingClientRect().bottom+1),
    pageScrolls: document.documentElement.scrollHeight > innerHeight+1,
  };
});

const L=await mk('landscape',{width:844,height:390},true); await host(L,'ls-'+Math.random().toString(36).slice(2,7));
await S(1500);
const land=await shape(L);
check('landscape gives the meeting most of the height', land.videos.h > land.vh*0.6, JSON.stringify(land));
check('landscape keeps the controls on screen', land.controlsOnScreen===true, JSON.stringify(land.controls));
check('landscape tiles fit the space they are in', land.tilesFit===true, JSON.stringify(land.tile));
check('landscape does not scroll the page', land.pageScrolls===false);

const P=await mk('portrait',{width:390,height:844},true); await host(P,'pt-'+Math.random().toString(36).slice(2,7));
await S(1500);
const port=await shape(P);
// The regression this suite was written for: the phone strip rules reached
// into gallery view and squashed it into a ribbon with a screenful of nothing.
check('portrait gallery fills the stage rather than a thin ribbon',
      port.videos.h > port.vh*0.6, JSON.stringify(port));
check('portrait keeps the controls on screen', port.controlsOnScreen===true, JSON.stringify(port.controls));
check('portrait tiles fit the space they are in', port.tilesFit===true, JSON.stringify(port.tile));

// ================= no placeholder where a name belongs =====================
const W=await mk('who');
await W.goto(BASE,{waitUntil:'networkidle'});
await W.click('#tabRegister');
await W.fill('#authName','Wendy');await W.fill('#authEmail',`w${Date.now()}@e.com`);await W.fill('#authPassword','secret123');
await W.click('#authSubmit');await W.waitForSelector('#lobby:not([hidden])',{timeout:15000});
const who=await W.evaluate(()=>({text:document.getElementById('whoami').textContent,
  label:document.getElementById('whoamiLabel').textContent,
  shown:!document.getElementById('whoamiWrap').hidden}));
check('the lobby names you instead of showing a placeholder',
      who.shown && who.text==='Wendy' && !/…|\.\.\./.test(who.text), JSON.stringify(who));
check('and says "Signed in as" for a real account', /Signed in as/.test(who.label), who.label);

await b.close();
const bad=R.filter(([ok])=>!ok);
console.log(`\n${R.length-bad.length}/${R.length} passed`);
if (bad.length) { for (const [,n,x] of bad) console.log(' FAILED:',n,x); process.exit(1); }
