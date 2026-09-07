// Produce a REAL Simple Minutes export by driving simple-minutes.html itself, rather than
// hand-writing a CSV that only looks like one.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const P = require('./paths');
const APP = 'file://' + P.simpleMinutesApp();
const LIB = P.tunebookLibrary();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  // The Registry fetch can't succeed from here; fail it fast so the app falls through to
  // its own manual picker rather than sitting on the timeout.
  await page.route('**raw.githubusercontent.com/**', r => r.abort());
  await page.goto(APP);
  await page.waitForTimeout(2500);

  // The GitHub fetch won't succeed from here; fall through to the manual picker.
  const needsFile = await page.evaluate(() => {
    const c = document.getElementById('loadCard');
    return !!(c && c.offsetParent !== null);
  });
  if (needsFile){
    await page.setInputFiles('#fileInput', LIB);
    await page.waitForTimeout(2000);
  }

  await page.fill('#eventInput', 'Tuesday Night Singing');
  await page.fill('#dateInput', '2026-09-01');
  await page.fill('#locationInput', "St. David's, Roland Park");
  await page.waitForTimeout(300);
  // pick the first offered common book
  await page.evaluate(() => {
    const b = document.querySelector('#commonBookRow input[type=checkbox], #commonBookRow button, #commonBookRow label');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await page.click('#doneSetupBtn');
  await page.waitForTimeout(800);

  // log some songs by number, plus a break
  async function tapKey(label){
    await page.evaluate((label) => {
      const btns = Array.from(document.querySelectorAll('#keypad button'));
      const b = btns.find(x => x.textContent.trim().toLowerCase() === label.toLowerCase());
      if (b) b.click();
    }, label);
    await page.waitForTimeout(140);
  }
  async function logNumber(digits){
    for (const d of digits.split('')) await tapKey(d);
    await page.click('#doneEntryBtn');
    await page.waitForTimeout(400);
    // a page with both a top and a bottom song asks for T or B
    let status = await page.evaluate(() => document.getElementById('displayStatus').textContent);
    if (/top and bottom/i.test(status)){
      await tapKey('t');
      await page.click('#doneEntryBtn');
      await page.waitForTimeout(400);
      status = await page.evaluate(() => document.getElementById('displayStatus').textContent);
    }
    // an unindexed page asks for a second Done
    if (/again to add it anyway/i.test(status)){
      await page.click('#doneEntryBtn');
      await page.waitForTimeout(400);
    }
  }
  for (const n of ['45', '59', '99', '146', '178']) await logNumber(n);
  await page.click('#breakBtn');
  await page.waitForTimeout(400);
  await logNumber('312');

  const csv = await page.evaluate(() => {
    // buildCsv isn't exposed; take the copy path's own text via the download blob instead
    return null;
  });

  // grab the real file through the actual Download button
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadBtn')
  ]);
  const out = path.resolve(__dirname, 'fixtures', 'simple-minutes-export.csv');
  await download.saveAs(out);

  const text = fs.readFileSync(out, 'utf8');
  console.log('saved:', out);
  console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
  console.log('--- first 4 lines ---');
  console.log(text.split(/\r?\n/).slice(0, 4).join('\n'));
  console.log('--- rows:', text.trim().split(/\r?\n/).length - 1, '---');
  await browser.close();
})();
