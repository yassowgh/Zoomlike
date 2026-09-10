// The one-link call, and the floating video window.
//
// A one-link call is answered rather than joined: the link puts you straight
// on the call with no name card and no camera check, microphone on and camera
// off, and the camera opens from inside the call. Ordinary invite links are
// unchanged and still ask who you are.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-call.mjs
import { chromium } from 'playwright';
const BASE=process.env.ZL_BASE||'http://127.0.0.1:8787';
const S=ms=>new Promise(r=>setTimeout(r,ms));
const R=[]; const check=(n,ok,x='')=>{R.push([ok,n,x]);console.log((ok?'PASS':'FAIL'),'·',n,x);};
const b=await chromium.launch({executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
const mk=async(t)=>{const c=await b.newContext({permissions:['camera','microphone'],viewport:{width:1280,height:900}});const p=await c.newPage();p.on('pageerror',e=>console.log(`[${t}]`,String(e).slice(0,160)));return p;};

// ---- the host creates the link ------------------------------------------
const H=await mk('host');
await H.goto(BASE,{waitUntil:'networkidle'});
await H.click('#tabRegister');
await H.fill('#authName','Hosty');await H.fill('#authEmail',`c${Date.now()}@e.com`);await H.fill('#authPassword','secret123');
await H.click('#authSubmit');await H.waitForSelector('#lobby:not([hidden])',{timeout:15000});
await H.click('#instantBtn');
await H.waitForSelector('#instantModal:not([hidden])',{timeout:15000});
const link=await H.inputValue('#instantLink');
const callRoom=(link.match(/\/room\/([A-Za-z0-9_-]+)/)||[])[1]||'';
check('the one-link call hands back a call link', /^call-[A-Za-z0-9]+$/.test(callRoom), link);

// the host's own "Start the call" goes the same way — no preview
await H.click('#instantStart');
await H.waitForSelector('#room:not([hidden])',{timeout:20000});
const hostIn=await H.evaluate(()=>({prejoin:!document.getElementById('prejoin').hidden,cam:window.__zl_state.camOn,mic:window.__zl_state.micOn}));
check('the host is not shown a camera check either', hostIn.prejoin===false, JSON.stringify(hostIn));
check('the host joins with the camera off', hostIn.cam===false && hostIn.mic===true, JSON.stringify(hostIn));

// ---- someone who has never been here follows the link -------------------
const C=await mk('caller');
await C.goto(BASE,{waitUntil:'networkidle'});
await C.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
await C.goto(`${BASE}/room/${callRoom}`,{waitUntil:'networkidle'});
await C.waitForSelector('#room:not([hidden])',{timeout:20000});
await S(2500);
const s1=await C.evaluate(()=>({
  quickJoin:!document.getElementById('quickJoin').hidden,
  prejoin:!document.getElementById('prejoin').hidden,
  notStarted:!document.getElementById('notStarted').hidden,
  waiting:!document.getElementById('waitingScreen').hidden,
  name:window.__zl_state.name, mic:window.__zl_state.micOn, cam:window.__zl_state.camOn,
  video:window.__zl_state.localStream.getVideoTracks().length,
  audio:window.__zl_state.localStream.getAudioTracks().length,
}));
check('the link asks for no name', s1.quickJoin===false, JSON.stringify(s1));
check('the link shows no camera check', s1.prejoin===false);
check('the link is not held at the door', s1.notStarted===false && s1.waiting===false);
check('the caller arrives with the microphone on', s1.mic===true && s1.audio>0, JSON.stringify(s1));
check('the caller arrives with the camera off', s1.cam===false && s1.video===0, JSON.stringify(s1));
check('the room names a nameless caller', /^Caller \d+$/.test(s1.name||''), s1.name);

// the host's roster shows that assigned name, not a blank
await S(1500);
const roster=await H.evaluate(()=>[...window.__zl_state.peerNames.values()]);
check('the name the room assigned reaches everyone else', roster.some(n=>/^Caller \d+$/.test(n)), JSON.stringify(roster));

// ---- the camera opens from inside the call -----------------------------
await C.click('#camBtn'); await S(2500);
const s2=await C.evaluate(()=>({
  cam:window.__zl_state.camOn,
  live:window.__zl_state.localStream.getVideoTracks().filter(t=>t.readyState==='live'&&t.enabled).length,
}));
check('the camera can be turned on once in the call', s2.cam===true && s2.live>0, JSON.stringify(s2));

// ---- the floating window ------------------------------------------------
const pip=await C.evaluate(()=>{
  const v=document.getElementById('pipVideo'), btn=document.getElementById('pipBtn');
  return {
    supported:document.pictureInPictureEnabled,
    hasVideo:!!v, hasBtn:!!btn, btnHidden:btn?btn.hidden:true,
    // A display:none video cannot enter picture-in-picture, so the source is
    // laid out off-screen instead.
    boxed:v?v.offsetWidth>0&&v.offsetHeight>0:false,
    onscreen:v?v.getBoundingClientRect().right>0:true,
  };
});
check('there is a floating-video control', pip.hasBtn && pip.hasVideo);
check('the floating control is offered where the browser supports it', pip.supported? pip.btnHidden===false : pip.btnHidden===true, JSON.stringify(pip));
check('the floating source is laid out, not display:none', pip.boxed===true, JSON.stringify(pip));
check('the floating source is not visible in the page', pip.onscreen===false, JSON.stringify(pip));

// with a camera live, asking to float finds a stream (no "turn a camera on")
if (pip.supported) {
  await C.click('#pipBtn'); await S(600);
  const t=await C.evaluate(()=>({hidden:document.getElementById('toast').hidden,text:document.getElementById('toast').textContent}));
  check('floating finds the live video', t.hidden===true || !/Turn a camera on/i.test(t.text), JSON.stringify(t));
  const src=await C.evaluate(()=>!!document.getElementById('pipVideo').srcObject);
  check('the floating window is fed the call video', src===true);
}

// ---- ordinary invite links are unchanged --------------------------------
const G=await mk('guest');
await G.goto(BASE,{waitUntil:'networkidle'});
await G.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
await G.goto(`${BASE}/room/plain-${Math.random().toString(36).slice(2,7)}`,{waitUntil:'networkidle'});
await G.waitForSelector('#quickJoin:not([hidden])',{timeout:15000});
await G.click('#qjSubmit'); await S(500);
const q=await G.evaluate(()=>({card:!document.getElementById('quickJoin').hidden,hint:document.getElementById('qjHint').textContent}));
check('an ordinary invite link still asks who you are', q.card===true && /name/i.test(q.hint), JSON.stringify(q));

// ---- and the server enforces the same split -----------------------------
const api=await G.evaluate(async(room)=>{
  const post=(body)=>fetch('/api/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.status);
  return {
    plainNameless: await post({}),
    plainGuest: await post({name:'Guest'}),
    callNameless: await post({room}),
    fakeCall: await post({room:'plain-room'}),
  };
},callRoom);
check('a nameless guest is refused on an ordinary link', api.plainNameless===400 && api.plainGuest===400, JSON.stringify(api));
check('a nameless caller is admitted on a call link', api.callNameless===200, JSON.stringify(api));
check('and a room that is not a call link cannot borrow that', api.fakeCall===400, JSON.stringify(api));

await b.close();
const bad=R.filter(([ok])=>!ok);
console.log(`\n${R.length-bad.length}/${R.length} passed`);
if (bad.length) { for (const [,n,x] of bad) console.log(' FAILED:',n,x); process.exit(1); }
