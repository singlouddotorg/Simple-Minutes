// Simple Minutes clock: readable, honest about the real time, and never moving the keypad.
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // The aborted Registry request below is this test's own doing, not the app's - the app
  // handles that failure by design, falling through to its manual library picker.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  page.on('dialog', d => d.accept());
  // no network at a venue, and none here either: the app's own manual library picker path
  await page.route('**raw.githubusercontent.com/**', r => r.abort());

  await page.goto(APP);
  await page.waitForTimeout(2500);
  if (await page.evaluate(() => { const c = document.getElementById('loadCard'); return !!(c && c.offsetParent !== null); })){
    await page.setInputFiles('#fileInput', LIB);
    await page.waitForTimeout(2000);
  }
  await page.fill('#eventInput', 'Clock Test');
  await page.fill('#dateInput', '2026-09-05');
  await page.fill('#locationInput', 'Union Hall');
  await page.evaluate(() => { const b = document.querySelector('#commonBookRow input[type=checkbox], #commonBookRow label'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.click('#doneSetupBtn');
  await page.waitForTimeout(800);

  const clockText = () => page.evaluate(() => document.getElementById('clock').textContent.trim());
  const box = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);

  // ---- shows a real time, matching the machine's own ----
  const shown = await clockText();
  check('clock renders a time', /\d{1,2}[:.]\d{2}/.test(shown), shown);
  const expected = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, '');
  check('clock agrees with the system clock', shown.replace(/\s+/g, '') === expected, shown + ' vs ' + expected);

  // ---- costs no vertical space and never moves the keypad ----
  const emptyDisplay = await box('.display-box');
  const emptyKeypad = await box('#keypad');
  async function tap(label){
    await page.evaluate(l => {
      const b = [...document.querySelectorAll('#keypad button')].find(x => x.textContent.trim().toLowerCase() === l.toLowerCase());
      if (b) b.click();
    }, label);
    await page.waitForTimeout(120);
  }
  for (const d of ['1','2','8']) await tap(d);
  const typedDisplay = await box('.display-box');
  const typedKeypad = await box('#keypad');
  check('display box does not grow when digits are typed',
    emptyDisplay.h === typedDisplay.h, emptyDisplay.h + 'px -> ' + typedDisplay.h + 'px');
  check('keypad does not move when digits are typed',
    emptyKeypad.y === typedKeypad.y, emptyKeypad.y + ' -> ' + typedKeypad.y);

  const clockEmpty = await box('#clock');
  await tap('t');
  const clockLong = await box('#clock');
  check('clock stays put as the typed number grows',
    clockEmpty.x === clockLong.x && clockEmpty.w === clockLong.w,
    JSON.stringify(clockEmpty) + ' -> ' + JSON.stringify(clockLong));

  // ---- big enough to glance at, and quieter than the page number ----
  const sizes = await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('clock'));
    const d = getComputedStyle(document.getElementById('displayDigits'));
    // Measure the RENDERED TEXT, not the element boxes: .display-digits carries a
    // min-height that makes its box taller than its glyphs, so comparing box bottoms would
    // report a difference that isn't on screen. Equal text-rect bottoms at equal font sizes
    // means the two sit on one baseline, which is what align-items:baseline is doing.
    function textRect(el){
      const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!node) return el.getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(node);
      return r.getBoundingClientRect();
    }
    const cr = textRect(document.getElementById('clock'));
    const dr = textRect(document.getElementById('displayDigits'));
    return { clock: parseFloat(c.fontSize), clockWeight: c.fontWeight, digits: parseFloat(d.fontSize),
             clockColor: c.color, digitsColor: d.color,
             clockBaseline: Math.round(cr.bottom), digitsBaseline: Math.round(dr.bottom) };
  });
  check('clock is large enough to read at a glance', sizes.clock >= 22, sizes.clock + 'px');
  check('clock is bold', Number(sizes.clockWeight) >= 600, sizes.clockWeight);
  // Kevin's call: same size as the page number, since the row has the space either way -
  // the hierarchy between them is carried by ink alone.
  check('clock matches the page number\'s size', sizes.clock === sizes.digits,
    sizes.clock + 'px vs ' + sizes.digits + 'px');
  check('clock sits on the page number\'s baseline', Math.abs(sizes.clockBaseline - sizes.digitsBaseline) <= 1,
    sizes.clockBaseline + ' vs ' + sizes.digitsBaseline);
  check('clock uses a softer ink than the page number', sizes.clockColor !== sizes.digitsColor,
    sizes.clockColor + ' vs ' + sizes.digitsColor);

  // ---- no horizontal overflow at a narrow phone width ----
  for (const w of [320, 360, 390, 428]){
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(300);
    // widest realistic pair for this row, forced: a 4-character page against a two-digit
    // 12-hour time. If these clear each other here, nothing a real singing produces collides.
    await page.evaluate(() => {
      document.getElementById('displayDigits').textContent = '128t';
      const c = document.getElementById('clock');
      c.textContent = '12:34';
      const s = document.createElement('span'); s.className = 'meridiem'; s.textContent = 'AM';
      c.appendChild(s);
    });
    await page.waitForTimeout(120);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const clipped = await page.evaluate(() => {
      const c = document.getElementById('clock').getBoundingClientRect();
      const d = document.getElementById('displayDigits').getBoundingClientRect();
      // also catch the two colliding, which is the real failure mode at full size
      return c.right > document.documentElement.clientWidth + 1 || c.width < 40 || d.right > c.left + 1;
    });
    const sameSize = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('clock')).fontSize)
      === parseFloat(getComputedStyle(document.getElementById('displayDigits')).fontSize));
    check('@ ' + w + 'px: worst-case pair fits, no overflow, clock still full size',
      overflow <= 0 && !clipped && sameSize,
      'overflow ' + overflow + ', clipped ' + clipped + ', sameSize ' + sameSize);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Undo the forced worst-case text above, so the tick test below is watching a real
  // repaint rather than the leftover placeholder changing.
  await page.evaluate(() => {
    document.getElementById('displayDigits').innerHTML = '&nbsp;';
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(300);

  // ---- ticks on the minute boundary, not 60s from page load ----
  const tick = await page.evaluate(() => new Promise(resolve => {
    // Fake the clock forward to two seconds before the next minute, re-arm, and watch for
    // the repaint. Proves the tick is aligned to the real minute rather than to load time.
    const el = document.getElementById('clock');
    const before = el.textContent.trim();
    const RealDate = Date;
    const base = new RealDate();
    const offset = ((59 - base.getSeconds()) * 1000 - base.getMilliseconds()) + 1000 - 2000;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a){ super(...(a.length ? a : [RealDate.now() + offset])); }
      static now(){ return RealDate.now() + offset; }
    };
    window.dispatchEvent(new Event('focus')); // re-arms the scheduler off the faked clock
    const started = RealDate.now();
    const iv = setInterval(() => {
      const now = el.textContent.trim();
      if (now !== before){
        clearInterval(iv);
        // eslint-disable-next-line no-global-assign
        Date = RealDate;
        resolve({ changed: true, ms: RealDate.now() - started, before: before, after: now });
      } else if (RealDate.now() - started > 6000){
        clearInterval(iv);
        // eslint-disable-next-line no-global-assign
        Date = RealDate;
        resolve({ changed: false, ms: RealDate.now() - started, before: before, after: now });
      }
    }, 100);
  }));
  check('clock re-ticks at the minute boundary, not 60s after load',
    tick.changed && tick.ms < 4000, JSON.stringify(tick));

  // ---- recovers after the screen has been off (throttled/suspended timers) ----
  const recovered = await page.evaluate(() => new Promise(resolve => {
    const el = document.getElementById('clock');
    el.textContent = '3:04 PM';   // whatever it was when the phone went to sleep
    const stale = el.textContent;
    document.dispatchEvent(new Event('visibilitychange'));
    setTimeout(() => resolve({ stale: stale, now: el.textContent.trim() }), 300);
  }));
  const expectedNow = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, '');
  check('returning to the app re-reads the real time rather than trusting the timer',
    recovered.now.replace(/\s+/g, '') === expectedNow, JSON.stringify(recovered));

  // ---- logging still works, and the CSV is untouched by any of this ----
  await page.click('#doneEntryBtn');
  await page.waitForTimeout(400);
  const logged = await page.evaluate(() => document.getElementById('tally').textContent);
  check('a song still logs normally with the clock present', /1 song/.test(logged), logged);

  // ---- the locale's own clock convention, both shapes ----
  for (const [locale, want, label] of [['en-US', /^\d{1,2}:\d{2}\s?[AP]M$/, '12-hour, no leading zero'],
                                       ['en-GB', /^\d{2}:\d{2}$/, '24-hour, leading zero']]){
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
    const p2 = await ctx.newPage();
    p2.on('dialog', d => d.accept());
    await p2.route('**raw.githubusercontent.com/**', r => r.abort());
    await p2.goto(APP);
    await p2.waitForTimeout(2200);
    if (await p2.evaluate(() => { const c = document.getElementById('loadCard'); return !!(c && c.offsetParent !== null); })){
      await p2.setInputFiles('#fileInput', LIB);
      await p2.waitForTimeout(1800);
    }
    await p2.fill('#eventInput', 'Locale Test');
    await p2.fill('#dateInput', '2026-09-05');
    await p2.fill('#locationInput', 'Union Hall');
    await p2.evaluate(() => { const b = document.querySelector('#commonBookRow input[type=checkbox], #commonBookRow label'); if (b) b.click(); });
    await p2.waitForTimeout(300);
    await p2.click('#doneSetupBtn');
    await p2.waitForTimeout(800);
    const t = (await p2.evaluate(() => document.getElementById('clock').textContent.trim())).replace(/\s+/g, ' ');
    check(locale + ': ' + label, want.test(t), t);
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log('\n' + results.length + ' checks, ' + failed + ' failed');
  process.exit(failed);
})();
