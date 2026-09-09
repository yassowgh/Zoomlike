// Meeting-control behaviours: active-speaker detection, asking the host to
// start the whiteboard, and per-recording approval.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-controls.mjs
import { chromium } from 'playwright';
const BASE=process.env.ZL_BASE||'http://127.0.0.1:8787';
const SHOT=process.env.ZL_SHOTS||new URL('./screenshots',import.meta.url).pathname;
import {mkdirSync} from 'node:fs'; mkdirSync(SHOT,{recursive:true});
const results=[]; const check=(n,ok,x='')=>{results.push([ok,n,x]);console.log((ok?'PASS':'FAIL'),'·',n,x);};
const b=await chromium.launch({executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const mk=async(n)=>{const c=await b.newContext({permissions:['camera','microphone'],viewport:{width:1280,height:800}});const p=await c.newPage();p.on('pageerror',e=>console.log(`  [${n}]`,String(e).slice(0,160)));p.on('console',m=>{if(m.type()==='error')console.log(`  [${n} err]`,m.text().slice(0,140));});return p;};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const room='r3-'+Math.random().toString(36).slice(2,6);
const H=await mk('host');
await H.goto(BASE,{waitUntil:'networkidle'});
await H.click('#tabRegister');await H.fill('#authName','Hosty');await H.fill('#authEmail',`r${Date.now()}@e.com`);await H.fill('#authPassword','secret123');
await H.click('#authSubmit');await H.waitForSelector('#lobby:not([hidden])');
await H.check('input[name="access"][value="open"]');
await H.fill('#roomInput',room);await H.click('#joinBtn');await H.waitForSelector('#room:not([hidden])');await S(2000);
const G=await mk('guest');
await G.goto(BASE,{waitUntil:'networkidle'});
await G.evaluate(()=>localStorage.setItem('zl_name','Guesty'));
await G.goto(`${BASE}/room/${room}`,{waitUntil:'networkidle'});await S(3500);
check('two peers connected', await H.evaluate(()=>document.querySelectorAll('#videos .tile').length)===2);

// ---- 17: whiteboard start needs host approval ----
await H.click('#moreBtn');await S(250);await H.click('#boardToggleBtn');await S(900); // host turns board OFF
check('17 · board off for guest', await G.evaluate(()=>window.__zl_state.boardOn)===false);
const guestBtn = await G.evaluate(()=>{const b=document.getElementById('boardToggleBtn');return{hidden:b.hidden,text:b.textContent.trim()};});
check('17 · guest is offered "ask to start"', !guestBtn.hidden && /Ask to start/i.test(guestBtn.text), JSON.stringify(guestBtn));
await G.click('#moreBtn');await S(250);await G.click('#boardToggleBtn');await S(1000);
const req = await H.evaluate(()=>document.getElementById('requestList').textContent);
check('17 · request reaches the host', /start the whiteboard/i.test(req), JSON.stringify(req.slice(0,60)));
check('17 · board still off until approved', await G.evaluate(()=>window.__zl_state.boardOn)===false);
const allow = await H.$('#requestList button:has-text("Allow")');
if (allow) await allow.click();
await S(1000);
check('17 · approval starts the whiteboard for everyone', await G.evaluate(()=>window.__zl_state.boardOn)===true);

// ---- 18: every recording needs fresh approval ----
await G.click('#recBtn');await S(900);
const rq=await H.evaluate(()=>document.getElementById('requestList').textContent);
check('18 · record request reaches the host', /record the meeting/i.test(rq), JSON.stringify(rq.slice(0,60)));
const allow2 = await H.$('#requestList button:has-text("Allow")');
if (allow2) await allow2.click();
await S(900);
check('18 · guest granted', await G.evaluate(()=>window.__zl_state.canRecord)===true);
await G.click('#recBtn');await S(300);
await G.click('#recMenu button[data-target="computer"]');await S(1500);
check('18 · guest is recording', await G.evaluate(()=>window.__zl_state.recorder.recording)===true);
const banner = await H.evaluate(()=>({hidden:document.getElementById('recBanner').hidden,txt:document.getElementById('recBanner').textContent}));
check('18 · everyone sees a recording marker', !banner.hidden && /Guesty/.test(banner.txt), JSON.stringify(banner));
check('18 · permission consumed on start', await G.evaluate(()=>window.__zl_state.canRecord)===false);
G.on('dialog',d=>d.accept());
await G.click('#recBtn');await S(2500); // stop
check('18 · stopped', await G.evaluate(()=>window.__zl_state.recorder.recording)===false);
const banner2 = await H.evaluate(()=>document.getElementById('recBanner').hidden);
check('18 · marker cleared when recording stops', banner2===true);
await G.click('#recBtn');await S(900);
const rq2=await H.evaluate(()=>document.getElementById('requestList').textContent);
check('18 · a second recording asks the host again', /record the meeting/i.test(rq2), JSON.stringify(rq2.slice(0,60)));

// ---- 16: active speaker ----
const speech = await H.evaluate(()=>({ hasDetector: !!window.__zl_state.speech, tracked: window.__zl_state.speech?.nodes?.size }));
check('16 · detector is running with audio sources', speech.hasDetector && speech.tracked>=2, JSON.stringify(speech));
// fake devices emit a tone, so someone should be picked as active
await S(3000);
const spk = await H.evaluate(()=>({active:window.__zl_state.activeSpeaker, remote:window.__zl_state.lastRemoteSpeaker, highlighted:document.querySelectorAll('#videos .tile.speaking').length}));
check('16 · an active speaker is detected and highlighted', !!spk.active && spk.highlighted>=1, JSON.stringify(spk));
await H.screenshot({path:SHOT+'/20-active-speaker.png'});

console.log('\n===== SUMMARY =====');
const f=results.filter(r=>!r[0]);
console.log(`${results.length-f.length}/${results.length} passed`);
f.forEach(x=>console.log('  FAILED:',x[1],x[2]));
await b.close();

process.exit(results.filter(r=>!r[0]).length?1:0);
