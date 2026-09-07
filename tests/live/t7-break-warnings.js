// Break warnings and the screen wake lock in Simple Minutes.
//
// The warning window is driven off the real clock, so these tests move the CLOCK rather
// than waiting seven minutes: Date is replaced inside the page and the tick re-armed, which
// is the same path a real minute boundary takes.
const { chromium } = require('playwright');
const path = require('path');

const P = require('./paths');
const APP = 'file://' + P.simpleMinutesApp();
const LIB = P.tunebookLibrary();

const results = [];
function check(name, ok, detail){
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + String(detail).replace(/\n/g, '\n        ') : ''));
}

// Pretend "now" is hh:mm, re-arm the clock, and report what the clock element looks like.
async function atTime(page, hh, mm){
  return page.evaluate(({ hh, mm }) => {
    if (!window.__RealDate) window.__RealDate = Date;
    const RealDate = window.__RealDate;
    const target = new RealDate();
    target.setHours(hh, mm, 5, 0);
    const offset = target.getTime() - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a){ super(...(a.length ? a : [RealDate.now() + offset])); }
      static now(){ return RealDate.now() + offset; }
    };
    window.dispatchEvent(new Event('focus')); // re-arms the scheduler, repaints the clock
    return new Promise(resolve => setTimeout(() => {
      const el = document.getElementById('clock');
      const cs = getComputedStyle(el);
      resolve({
        text: el.textContent.trim(),
        warning: el.classList.contains('break-soon'),
        animated: cs.animationName !== 'none',
        color: cs.color
      });
    }, 120));
  }, { hh, mm });
}
async function realTimeAgain(page){
  await page.evaluate(() => { if (window.__RealDate){ /* eslint-disable-next-line no-global-assign */ Date = window.__RealDate; } });
}

async function setup(page, breaks, opts){
  opts = opts || {};
  await page.goto(APP);
  await page.waitForTimeout(2200);
  if (await page.evaluate(() => { const c = document.getElementById('loadCard'); return !!(c && c.offsetParent !== null); })){
    await page.setInputFiles('#fileInput', LIB);
    await page.waitForTimeout(1800);
  }
  await page.fill('#eventInput', 'Break Test');
  await page.fill('#dateInput', '2026-09-05');
  await page.fill('#locationInput', 'Union Hall');
  await page.evaluate(() => { const b = document.querySelector('#commonBookRow input[type=checkbox], #commonBookRow label'); if (b) b.click(); });
  await page.waitForTimeout(250);
  for (const t of breaks){
    await page.click('#addBreakBtn');
    await page.waitForTimeout(150);
    await page.evaluate(v => {
      const inputs = document.querySelectorAll('#breakList input[type=time]');
      const last = inputs[inputs.length - 1];
      last.value = v;
      last.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
    await page.waitForTimeout(150);
  }
  if (opts.keepAwake){
    await page.evaluate(() => { const t = document.getElementById('wakeLockToggle'); if (!t.disabled && !t.checked) t.click(); });
    await page.waitForTimeout(200);
  }
  await page.click('#doneSetupBtn');
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**raw.githubusercontent.com/**', r => r.abort());

  // ---- multiple breaks, entered on Setup ----
  await setup(page, ['10:30', '12:15']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('simpleMinutesSetupV1') || '{}'));
  check('both break times are saved with Setup', JSON.stringify(stored.breakTimes) === JSON.stringify(['10:30', '12:15']),
    JSON.stringify(stored.breakTimes));

  // ---- the window: 5 minutes before through 2 minutes after ----
  const cases = [
    [10, 24, false, 'six minutes before: quiet'],
    [10, 25, true,  'five minutes before: warning starts'],
    [10, 29, true,  'one minute before: warning'],
    [10, 30, true,  'at the break time: warning'],
    [10, 32, true,  'two minutes after: still warning'],
    [10, 33, false, 'three minutes after: warning ends'],
    [11, 30, false, 'an hour later: quiet'],
    [12, 12, true,  'the SECOND break warns too'],
    [12, 18, false, 'and stops after its own window']
  ];
  for (const [hh, mm, want, label] of cases){
    const state = await atTime(page, hh, mm);
    check(label, state.warning === want, state.text + ' warning=' + state.warning);
  }

  // ---- what the warning actually looks like ----
  const warn = await atTime(page, 10, 28);
  const calm = await atTime(page, 11, 0);
  check('warning is oxblood, not the ordinary ink', warn.color !== calm.color, warn.color + ' vs ' + calm.color);
  check('warning pulses', warn.animated === true, 'animation ' + warn.animated);
  check('the clock is not animated the rest of the time', calm.animated === false, 'animation ' + calm.animated);
  check('the time itself is still readable while warning', /\d{1,2}:\d{2}/.test(warn.text), warn.text);

  // ---- taking the break clears its own warning, and only its own ----
  await atTime(page, 10, 28);
  await page.click('#breakBtn');
  await page.waitForTimeout(300);
  const afterBreak = await page.evaluate(() => document.getElementById('clock').classList.contains('break-soon'));
  check('logging a Break stops that break\'s warning', afterBreak === false);
  const secondStill = await atTime(page, 12, 14);
  check('the later break still warns after an earlier one was taken', secondStill.warning === true, secondStill.text);
  const marker = await page.evaluate(() => JSON.parse(localStorage.getItem('simpleMinutesEntriesV1') || '[]').filter(e => e.type === 'marker').length);
  check('the Break marker itself was still logged', marker === 1, marker + ' markers');

  await realTimeAgain(page);

  // ---- break times stay out of the CSV ----
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadBtn')
  ]);
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  check('break times are not written into the CSV', !/10:30|12:15/.test(csv.replace(/\d{2}:\d{2}:\d{2}/g, '')),
    (csv.split('\n')[1] || '').slice(0, 80));
  check('the CSV still carries the real RECESS marker', /RECESS/.test(csv));

  // ---- removing a break ----
  await page.click('#editSetupLink');
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelectorAll('#breakList .remove-break')[0].click(); });
  await page.waitForTimeout(300);
  const left = await page.evaluate(() => document.querySelectorAll('#breakList input[type=time]').length);
  check('a break time can be removed', left === 1, left + ' rows left');
  await page.click('#doneSetupBtn');
  await page.waitForTimeout(500);
  const goneState = await atTime(page, 10, 28);
  check('the removed break no longer warns', goneState.warning === false, goneState.text);
  await realTimeAgain(page);

  // ---- an abandoned empty row is not a break at midnight ----
  await page.click('#editSetupLink');
  await page.waitForTimeout(300);
  await page.click('#addBreakBtn');
  await page.waitForTimeout(200);
  await page.click('#doneSetupBtn');
  await page.waitForTimeout(400);
  const savedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('simpleMinutesSetupV1') || '{}').breakTimes);
  check('an empty break row is discarded rather than saved', savedAfter.every(t => /^\d{1,2}:\d{2}$/.test(t)),
    JSON.stringify(savedAfter));
  const midnight = await atTime(page, 0, 1);
  check('an abandoned empty row does not warn at midnight', midnight.warning === false, midnight.text);
  await realTimeAgain(page);

  // ---- reduced motion: colour without the pulse ----
  const rmCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const rmPage = await rmCtx.newPage();
  rmPage.on('dialog', d => d.accept());
  await rmPage.route('**raw.githubusercontent.com/**', r => r.abort());
  await setup(rmPage, ['10:30']);
  const rmWarn = await atTime(rmPage, 10, 28);
  check('reduced motion still gets the red warning', rmWarn.warning === true && /rgb\(138, 46, 46\)/.test(rmWarn.color), rmWarn.color);
  check('reduced motion does not pulse', rmWarn.animated === false, 'animation ' + rmWarn.animated);
  await rmCtx.close();

  // ---- wake lock ----
  const wlCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const wlPage = await wlCtx.newPage();
  wlPage.on('dialog', d => d.accept());
  await wlPage.route('**raw.githubusercontent.com/**', r => r.abort());
  await wlPage.addInitScript(() => {
    // Record what the app asks for. Chromium headless doesn't grant a real screen lock, so
    // the assertion is that the app requests and releases at the right moments.
    window.__wake = { requests: [], releases: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: type => {
        window.__wake.requests.push(type);
        const listeners = [];
        return Promise.resolve({
          type, released: false,
          addEventListener: (n, f) => listeners.push(f),
          release(){ window.__wake.releases++; listeners.forEach(f => f()); return Promise.resolve(); }
        });
      } }
    });
  });
  await setup(wlPage, ['10:30'], { keepAwake: true });
  const req = await wlPage.evaluate(() => window.__wake.requests.slice());
  check('starting to log requests a screen wake lock when asked to', req.length === 1 && req[0] === 'screen', JSON.stringify(req));
  const savedWake = await wlPage.evaluate(() => JSON.parse(localStorage.getItem('simpleMinutesSetupV1') || '{}').keepAwake);
  check('the keep-awake choice is remembered', savedWake === true, String(savedWake));

  await wlPage.click('#editSetupLink');
  await wlPage.waitForTimeout(300);
  const rel = await wlPage.evaluate(() => window.__wake.releases);
  check('leaving the log screen releases the lock', rel >= 1, rel + ' releases');

  await wlPage.click('#doneSetupBtn');
  await wlPage.waitForTimeout(400);
  const req2 = await wlPage.evaluate(() => window.__wake.requests.length);
  check('returning to logging re-acquires it', req2 === 2, req2 + ' requests');

  // Holding one lock must not request a second one.
  await wlPage.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await wlPage.waitForTimeout(300);
  const reqSame = await wlPage.evaluate(() => window.__wake.requests.length);
  check('a visibility event while already holding a lock does not request another',
    reqSame === 2, reqSame + ' requests');

  // A real hide/show cycle: the system drops the lock when the page is hidden and does NOT
  // restore it, so returning has to take a fresh one or the screen quietly starts sleeping
  // again for the rest of the singing.
  await wlPage.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wlPage.waitForTimeout(200);
  await wlPage.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wlPage.waitForTimeout(300);
  const req3 = await wlPage.evaluate(() => window.__wake.requests.length);
  check('coming back after the screen was off re-acquires the lock', req3 === 3, req3 + ' requests');

  // and an unchecked toggle asks for nothing at all
  const wl2Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const wl2 = await wl2Ctx.newPage();
  wl2.on('dialog', d => d.accept());
  await wl2.route('**raw.githubusercontent.com/**', r => r.abort());
  await wl2.addInitScript(() => {
    window.__wake = { requests: [] };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true,
      value: { request: t => { window.__wake.requests.push(t); return Promise.resolve({ addEventListener(){}, release(){ return Promise.resolve(); } }); } } });
  });
  await setup(wl2, ['10:30']);
  const noReq = await wl2.evaluate(() => window.__wake.requests.length);
  check('leaving the toggle off requests no wake lock', noReq === 0, noReq + ' requests');
  await wl2Ctx.close();

  // a browser without the API says so rather than offering a dead switch
  const noApiCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const noApi = await noApiCtx.newPage();
  noApi.on('dialog', d => d.accept());
  await noApi.route('**raw.githubusercontent.com/**', r => r.abort());
  await noApi.addInitScript(() => { Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }); });
  await noApi.goto(APP);
  await noApi.waitForTimeout(2200);
  const unsupported = await noApi.evaluate(() => ({
    disabled: document.getElementById('wakeLockToggle').disabled,
    note: document.getElementById('wakeLockNote').textContent
  }));
  check('an unsupported browser disables the toggle and explains why',
    unsupported.disabled === true && /can't keep the screen awake/.test(unsupported.note), unsupported.note.slice(0, 90));
  await noApiCtx.close();
  await wlCtx.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log('\n' + results.length + ' checks, ' + failed + ' failed');
  process.exit(failed);
})();
