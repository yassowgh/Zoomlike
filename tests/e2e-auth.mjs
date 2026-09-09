// Google sign-in and password reset.
//
// Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (dummy values are fine - the
// Google redirect is checked, not completed) and MAIL_WEBHOOK_URL pointing at
// the local mailbox this file starts. See .dev.vars.example.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-auth.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
const BASE=process.env.ZL_BASE||'http://127.0.0.1:8787';

const SHOT=process.env.ZL_SHOTS||new URL('./screenshots',import.meta.url).pathname;
mkdirSync(SHOT,{recursive:true});
const results=[]; const check=(n,ok,x='')=>{results.push([ok,n,x]);console.log((ok?'PASS':'FAIL'),'·',n,x);};

// Stand in for the email provider. MAIL_WEBHOOK_URL in .dev.vars must point
// here so we can read the reset link the worker sends.
const inbox=[];
const mailbox=http.createServer((req,res)=>{
  let body=''; req.on('data',c=>body+=c);
  req.on('end',()=>{ try{inbox.push(JSON.parse(body));}catch{} res.writeHead(200,{'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r=>mailbox.listen(8799,'127.0.0.1',r));

const cfg = await (await fetch(BASE+'/api/config')).json();
if (!cfg.googleAuth || !cfg.passwordReset) {
  console.log('SKIP - this needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and');
  console.log('       MAIL_WEBHOOK_URL=http://127.0.0.1:8799/mail in .dev.vars.');
  console.log('       See .dev.vars.example.');
  mailbox.close(); process.exit(0);
}
const S=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',args:['--no-sandbox']});
const mk=async(n)=>{const c=await b.newContext({viewport:{width:1280,height:900}});const p=await c.newPage();p.on('pageerror',e=>console.log(`  [${n}]`,String(e).slice(0,160)));return p;};

const email=`u${Date.now()}@example.com`;
const P=await mk('auth');

// ---- register a normal account ----
await P.goto(BASE,{waitUntil:'networkidle'});
check('19 · Google button shown when configured', await P.evaluate(()=>!document.getElementById('googleBox').hidden));
await P.screenshot({path:SHOT+'/21-auth-google.png'});
await P.click('#tabRegister');
check('20 · forgot link hidden on the register tab', await P.evaluate(()=>document.getElementById('forgotRow').hidden));
await P.fill('#authName','Reset Me'); await P.fill('#authEmail',email); await P.fill('#authPassword','origpass1');
await P.click('#authSubmit'); await P.waitForSelector('#lobby:not([hidden])',{timeout:15000});
check('account created', true);
await P.evaluate(()=>{localStorage.clear();sessionStorage.clear();});

// ---- 19: google start redirects to Google with the right params ----
const r = await P.evaluate(async()=>{
  const res = await fetch('/api/auth/google/start?to=%2Froom%2Fabc', { redirect:'manual' });
  return { status: res.status, type: res.type };
});
const nav = await P.context().request.get(`${BASE}/api/auth/google/start?to=%2Froom%2Fabc`, { maxRedirects: 0 });
const loc = nav.headers()['location'] || '';
const u = new URL(loc);
check('19 · start redirects to Google accounts', u.origin+u.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', loc.slice(0,60));
check('19 · sends our client id', u.searchParams.get('client_id')==='test-client-id.apps.googleusercontent.com');
check('19 · asks for openid email profile', u.searchParams.get('scope')==='openid email profile');
check('19 · redirect_uri points back at us', u.searchParams.get('redirect_uri')===`${BASE}/api/auth/google/callback`, u.searchParams.get('redirect_uri'));
check('19 · carries a signed state', (u.searchParams.get('state')||'').split('.').length===3);

// callback with a forged/absent state must be rejected
const cb = await P.context().request.get(`${BASE}/api/auth/google/callback?code=x&state=forged`, { maxRedirects: 0 });
const cbLoc = cb.headers()['location']||'';
check('19 · callback rejects an unsigned state', cbLoc.includes('autherror'), cbLoc.slice(0,70));

// open redirect attempt in `to`
const ev = await P.context().request.get(`${BASE}/api/auth/google/start?to=https%3A%2F%2Fevil.example.com`, { maxRedirects: 0 });
const evState = new URL(ev.headers()['location']).searchParams.get('state');
const payload = JSON.parse(Buffer.from(evState.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
check('19 · an absolute URL in `to` is not honoured', payload.to === '/', `to=${payload.to}`);
const ev2 = await P.context().request.get(`${BASE}/api/auth/start?to=%2F%2Fevil.com`, { maxRedirects: 0 }).catch(()=>null);
const ev3 = await P.context().request.get(`${BASE}/api/auth/google/start?to=%2F%2Fevil.com`, { maxRedirects: 0 });
const p3 = JSON.parse(Buffer.from(new URL(ev3.headers()['location']).searchParams.get('state').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
check('19 · a protocol-relative `to` is not honoured', p3.to === '/', `to=${p3.to}`);

// ---- 20: forgot password end to end ----
await P.goto(BASE,{waitUntil:'networkidle'});
await P.click('#forgotBtn'); await S(300);
check('20 · forgot form opens', await P.evaluate(()=>!document.getElementById('forgotForm').hidden));
await P.fill('#forgotEmail', email);
await P.click('#forgotSubmit'); await S(1500);
const hint = await P.evaluate(()=>document.getElementById('authHint').textContent);
check('20 · user gets a non-committal confirmation', /on its way/i.test(hint), JSON.stringify(hint));
await P.screenshot({path:SHOT+'/22-forgot.png'});

const mine=inbox.filter(m=>m.to===email);
check('20 · a reset email was dispatched', mine.length===1, `${mine.length} message(s)`);
const link = mine[0]?.link || '';
check('20 · email carries a reset link', /\/\?reset=[0-9a-f]{64}/.test(link), link.slice(0,60));

// unknown address must look identical and send nothing
const before=inbox.length;
await P.goto(BASE,{waitUntil:'networkidle'});
await P.click('#forgotBtn'); await S(200);
await P.fill('#forgotEmail','nobody-'+Date.now()+'@example.com');
await P.click('#forgotSubmit'); await S(1200);
const hint2 = await P.evaluate(()=>document.getElementById('authHint').textContent);
check('20 · unknown address gets the same answer (no account enumeration)', hint2===hint, JSON.stringify(hint2.slice(0,40)));
check('20 · and no email is sent for it', inbox.length===before, `${inbox.length} vs ${before}`);

// ---- use the link ----
await P.goto(link,{waitUntil:'networkidle'}); await S(600);
check('20 · reset link opens the new-password screen', await P.evaluate(()=>!document.getElementById('resetScreen').hidden));
await P.screenshot({path:SHOT+'/23-reset.png'});
await P.fill('#resetPassword','short'); await P.click('#resetSubmit'); await S(900);
check('20 · short password refused', /at least 6/i.test(await P.evaluate(()=>document.getElementById('resetHint').textContent)));
await P.fill('#resetPassword','brandnewpass'); await P.click('#resetSubmit');
await P.waitForSelector('#lobby:not([hidden])',{timeout:15000});
check('20 · reset succeeds and signs the user in', true);

// token is single use
const P2=await mk('reuse');
await P2.goto(link,{waitUntil:'networkidle'}); await S(500);
await P2.fill('#resetPassword','anotherpass'); await P2.click('#resetSubmit'); await S(1200);
check('20 · the reset link cannot be used twice', /already been used|not valid/i.test(await P2.evaluate(()=>document.getElementById('resetHint').textContent)));

// old password no longer works, new one does
const P3=await mk('login');
await P3.goto(BASE,{waitUntil:'networkidle'});
await P3.fill('#authEmail',email); await P3.fill('#authPassword','origpass1'); await P3.click('#authSubmit'); await S(1200);
check('20 · the old password stops working', /incorrect/i.test(await P3.evaluate(()=>document.getElementById('authHint').textContent)));
await P3.fill('#authPassword','brandnewpass'); await P3.click('#authSubmit');
await P3.waitForSelector('#lobby:not([hidden])',{timeout:15000});
check('20 · the new password works', true);

console.log('\n===== SUMMARY =====');
const f=results.filter(x=>!x[0]);
console.log(`${results.length-f.length}/${results.length} passed`);
f.forEach(x=>console.log('  FAILED:',x[1],x[2]));
await b.close();
mailbox.close();
process.exit(results.filter(r=>!r[0]).length?1:0);
