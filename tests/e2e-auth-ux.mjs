// Sign-in behaviour: validation and messages on the form, a generic error for
// wrong credentials, the lockout after repeated failures, and the one-link call.
//
//   npx wrangler dev --port 8787 --local
//   node tests/e2e-auth-ux.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.ZL_BASE || 'http://127.0.0.1:8787';
const SHOT = process.env.ZL_SHOTS || new URL('./screenshots', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });
const R = []; const check = (n, ok, x='') => { R.push([ok,n,x]); console.log((ok?'PASS':'FAIL'),'·',n,x); };
const S = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: process.env.ZL_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'],
});
const mk = async (tag, vp, m) => {
  const c = await browser.newContext({ permissions:['camera','microphone'], viewport: vp||{width:1280,height:900}, ...(m?{isMobile:true,hasTouch:true}:{}) });
  const p = await c.newPage();
  p.on('pageerror', e => console.log(`  [${tag}]`, String(e).slice(0,180)));
  return p;
};
const state = p => p.evaluate(() => ({
  hint: document.getElementById('authHint').textContent,
  hintErr: document.getElementById('authHint').classList.contains('error'),
  email: { err: document.getElementById('errEmail').hidden ? '' : document.getElementById('errEmail').textContent,
           invalid: document.getElementById('authEmail').classList.contains('invalid') },
  pass:  { err: document.getElementById('errPassword').hidden ? '' : document.getElementById('errPassword').textContent,
           invalid: document.getElementById('authPassword').classList.contains('invalid') },
}));

const P = await mk('auth');
await P.goto(BASE, { waitUntil: 'networkidle' });

// ---------- empty submit says something ----------
await P.click('#authSubmit'); await S(400);
let st = await state(P);
check('submitting an empty form reports the missing email', !!st.email.err && st.email.invalid, JSON.stringify(st.email));
await P.screenshot({ path: `${SHOT}/70-login-empty.png` });

// ---------- a non-email is rejected ----------
await P.fill('#authEmail', 'ds');
await P.click('#authSubmit'); await S(400);
st = await state(P);
check('"ds" is rejected as an email address', /email address/i.test(st.email.err), JSON.stringify(st.email));
check('and the password field is flagged too', st.pass.invalid);
await P.screenshot({ path: `${SHOT}/71-login-invalid.png` });

// ---------- typing clears the mark ----------
await P.fill('#authEmail', 'someone@example.com'); await S(200);
check('fixing a field clears its error', !(await state(P)).email.invalid);

// ---------- the login password placeholder is not the signup hint ----------
check('the login password field does not say "At least 6 characters"',
      await P.evaluate(() => document.getElementById('authPassword').placeholder) === 'Your password');
await P.click('#tabRegister'); await S(200);
check('but the register tab does', await P.evaluate(() => document.getElementById('authPassword').placeholder) === 'At least 6 characters');
await P.click('#tabLogin'); await S(200);

// ---------- register, then log in again with the same credentials ----------
const email = `ux${Date.now()}@example.com`;
await P.click('#tabRegister'); await S(200);
await P.fill('#authName','UX Tester'); await P.fill('#authEmail', email); await P.fill('#authPassword','secret123');
await P.click('#authSubmit'); await P.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
check('registration works', true);
await P.click('#logoutBtn'); await P.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
await P.fill('#authEmail', email); await P.fill('#authPassword','secret123');
await P.click('#authSubmit'); await P.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
check('logging in again with the same email and password works', true);

// ---------- registering an existing address moves you to the login tab ----------
await P.click('#logoutBtn'); await P.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
await P.click('#tabRegister'); await S(200);
await P.fill('#authName','Again'); await P.fill('#authEmail', email); await P.fill('#authPassword','secret123');
await P.click('#authSubmit'); await S(1200);
const tab = await P.evaluate(() => ({ login: document.getElementById('tabLogin').classList.contains('active'), hint: document.getElementById('authHint').textContent }));
check('registering an existing address switches to Log in and explains why',
      tab.login && /already exists/i.test(tab.hint), JSON.stringify(tab));

// ---------- wrong credentials give one generic message ----------
const W = await mk('wrong');
await W.goto(BASE, { waitUntil: 'networkidle' });
await W.fill('#authEmail','nobody-'+Date.now()+'@example.com'); await W.fill('#authPassword','whatever1');
await W.click('#authSubmit'); await S(900);
const unknown = (await state(W)).hint;
await W.fill('#authEmail', email); await W.fill('#authPassword','definitelywrong');
await W.click('#authSubmit'); await S(900);
const badPass = (await state(W)).hint;
check('an unknown address and a wrong password give the same message',
      unknown === badPass && /incorrect/i.test(badPass), JSON.stringify({unknown, badPass}));
check('and it is shown as an error', (await state(W)).hintErr === true);

// ---------- lockout after five failures ----------
const L = await mk('lock');
const lockEmail = `lock${Date.now()}@example.com`;
await L.goto(BASE, { waitUntil: 'networkidle' });
await L.click('#tabRegister'); await S(200);
await L.fill('#authName','Locky'); await L.fill('#authEmail', lockEmail); await L.fill('#authPassword','secret123');
await L.click('#authSubmit'); await L.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
await L.click('#logoutBtn'); await L.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
let lockMsg = '';
for (let i = 1; i <= 5; i++) {
  await L.fill('#authEmail', lockEmail); await L.fill('#authPassword', 'wrong' + i);
  await L.click('#authSubmit'); await S(700);
  lockMsg = (await state(L)).hint;
}
// the fifth failure trips the lock; the next attempt is refused outright
await L.fill('#authEmail', lockEmail); await L.fill('#authPassword','secret123');
await L.click('#authSubmit'); await S(900);
const locked = (await state(L)).hint;
check('five wrong passwords lock the account for a few minutes',
      /too many failed attempts/i.test(locked) && /minute/i.test(locked), JSON.stringify(locked));
check('and the correct password is refused while locked',
      await L.evaluate(() => document.getElementById('lobby').hidden) === true);
await L.screenshot({ path: `${SHOT}/72-locked.png` });

// ---------- forgot-password link hidden when mail is not configured ----------
const cfg = await P.evaluate(async () => (await (await fetch('/api/config')).json()).passwordReset);
const forgotHidden = await W.evaluate(() => document.getElementById('forgotRow').hidden);
check('the reset link is only offered when this server can send email',
      cfg ? !forgotHidden : forgotHidden, `passwordReset=${cfg} hidden=${forgotHidden}`);

// ---------- one-link call ----------
await P.goto(BASE, { waitUntil: 'networkidle' });
await P.fill('#authEmail', email); await P.fill('#authPassword','secret123');
await P.click('#authSubmit'); await P.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
await P.click('#instantBtn');
await P.waitForSelector('#instantModal:not([hidden])', { timeout: 15000 });
const link = await P.evaluate(() => document.getElementById('instantLink').value);
check('a one-link call produces a shareable link', /\/room\/call-[a-z0-9]+$/.test(link), link);
await P.screenshot({ path: `${SHOT}/73-onelink.png` });

// someone opening it is in the call without a host present
const G = await mk('caller');
await G.goto(BASE, { waitUntil: 'networkidle' });
await G.evaluate(() => localStorage.setItem('zl_name','Caller'));
await G.goto(link, { waitUntil: 'networkidle' });
await G.waitForSelector('#prejoin:not([hidden])', { timeout: 15000 });
await G.click('#pjJoin');
await G.waitForSelector('#room:not([hidden])', { timeout: 15000 });
await S(3000);
const inCall = await G.evaluate(() => ({
  inRoom: !document.getElementById('room').hidden,
  notStarted: !document.getElementById('notStarted').hidden,
  waiting: !document.getElementById('waitingScreen').hidden,
}));
check('following a one-link call puts you straight in, with no host present',
      inCall.inRoom && !inCall.notStarted && !inCall.waiting, JSON.stringify(inCall));

console.log('\n===== SUMMARY =====');
const f = R.filter(r => !r[0]);
console.log(`${R.length - f.length}/${R.length} passed`);
f.forEach(x => console.log('  FAILED:', x[1], x[2]));
await browser.close();
process.exit(f.length ? 1 : 0);
