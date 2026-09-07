// Simple Minutes' handling of tunebook-library.js: 2026-09-06c revised release-readiness
// review, priorities 2-4.
//
//   - Priority 2 (release blocker, security): the file used to be run through
//     new Function() before anything looked at its contents - any statement anywhere in
//     it executed in this page's own context. Fixed by extracting only the real
//     "const EZ_MINUTES_TUNEBOOK_LIBRARY = { ... }" object text and handing it to
//     JSON.parse(), which cannot execute code. This file confirms live that a file
//     carrying an extraneous statement does not run it, on both the manual-picker path
//     and the automatic Registry-fetch path.
//   - Priority 3 (release blocker): an unrecognized Library schemaVersion is rejected
//     with a clear message rather than silently misread.
//   - Priority 4: this app now ships its own copy of tunebook-library.js purely as an
//     offline fallback, reached before the manual picker whenever the Registry fetch
//     fails, times out, or comes back invalid - including the very first time this tool
//     is ever opened, with no prior successful load to fall back on.
const { chromium } = require('playwright');
const P = require('./paths');
const APP = 'file://' + P.simpleMinutesApp();

const results = [];
function check(name, ok, detail){
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + String(detail).replace(/\n/g, '\n        ') : ''));
}

// A minimal, genuinely valid library, in already-quoted (i.e. directly JSON-parseable)
// form - the shape a hand-written test file can use without also reproducing this
// suite's own writer template. schemaFieldLine defaults to a recognized schema.
function libraryContent(schemaFieldLine){
  return 'const EZ_MINUTES_TUNEBOOK_LIBRARY = {\n' +
    '  ' + (schemaFieldLine === undefined ? '"schemaVersion": "1",' : schemaFieldLine) + '\n' +
    '  "migrationIssues": [],\n' +
    '  "works": {},\n' +
    '  "editions": { "TEST": { "editionCode": "TEST", "commonName": "Test Book", "ezMinutesVisibility": "common", "indexStatus": "none" } }\n' +
    '};\n';
}

async function newSandboxedPage(browser){
  // Every scenario here wants full control over both the Registry fetch and the bundled
  // tunebook-library.js <script> load, rather than whichever the real network/filesystem
  // would otherwise supply - so each starts from a page where neither has resolved yet.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  return { context, page };
}

async function pickManualFile(page, contents){
  await page.evaluate(() => {
    document.getElementById('autoLoadCard').style.display = 'none';
    document.getElementById('loadCard').style.display = 'block';
  });
  await page.setInputFiles('#fileInput', { name: 'tunebook-library.js', mimeType: 'text/javascript', buffer: Buffer.from(contents) });
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    errorVisible: document.getElementById('loadError').style.display !== 'none',
    errorText: document.getElementById('loadError').textContent,
    loadCardGone: document.getElementById('loadCard').style.display === 'none'
  }));
}

(async () => {
  const browser = await chromium.launch();

  // ---- Priority 2: the manual-picker path never executes an imported file as code ----
  {
    const { context, page } = await newSandboxedPage(browser);
    await page.route('**raw.githubusercontent.com/**', r => r.abort());
    await page.goto(APP);
    await page.waitForTimeout(2200);
    const malicious = 'window.__PWNED__ = true;\n' + libraryContent();
    const state = await pickManualFile(page, malicious);
    const pwned = await page.evaluate(() => window.__PWNED__ === true);
    check('a statement alongside a valid Library object does not execute (manual picker)',
      pwned === false, 'window.__PWNED__=' + pwned);
    check('the valid Library inside that same file still loads', state.loadCardGone === true, JSON.stringify(state));
    await context.close();
  }

  // ---- Priority 2: the automatic Registry-fetch path never executes it either ----
  {
    const { context, page } = await newSandboxedPage(browser);
    const malicious = 'window.__PWNED__ = true;\n' + libraryContent();
    await page.route('**raw.githubusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: malicious }));
    await page.goto(APP);
    await page.waitForTimeout(2200);
    const pwned = await page.evaluate(() => window.__PWNED__ === true);
    check('a statement alongside a valid Library object does not execute (auto Registry fetch)',
      pwned === false, 'window.__PWNED__=' + pwned);
    const reachedNext = await page.evaluate(() => document.getElementById('loadCard').style.display === 'none' && document.getElementById('autoLoadCard').style.display === 'none');
    check('the valid Library inside that fetched file still loads', reachedNext === true);
    await context.close();
  }

  // ---- Priority 3: schema gate, manual picker ----
  {
    const { context, page } = await newSandboxedPage(browser);
    await page.route('**raw.githubusercontent.com/**', r => r.abort());
    await page.goto(APP);
    await page.waitForTimeout(2200);
    const good = await pickManualFile(page, libraryContent('"schemaVersion": "1",'));
    check('schema "1" is accepted', good.loadCardGone === true && good.errorVisible === false, JSON.stringify(good));
    await context.close();
  }
  {
    const { context, page } = await newSandboxedPage(browser);
    await page.route('**raw.githubusercontent.com/**', r => r.abort());
    await page.goto(APP);
    await page.waitForTimeout(2200);
    const bad = await pickManualFile(page, libraryContent('"schemaVersion": "999",'));
    check('schema "999" is rejected with a clear message', bad.errorVisible === true && /schema/i.test(bad.errorText), bad.errorText);
    await context.close();
  }
  {
    const { context, page } = await newSandboxedPage(browser);
    await page.route('**raw.githubusercontent.com/**', r => r.abort());
    await page.goto(APP);
    await page.waitForTimeout(2200);
    const missing = await pickManualFile(page, libraryContent(''));
    check('a missing schemaVersion is rejected, not silently treated as schema 1', missing.errorVisible === true && /schema/i.test(missing.errorText), missing.errorText);
    await context.close();
  }

  // ---- Priority 4: first-ever offline start, no network at all, reaches Setup ----
  {
    const { context, page } = await newSandboxedPage(browser);
    // No prior successful load has ever happened on this "device": nothing to fall back
    // on but the copy of tunebook-library.js bundled beside index.html.
    await page.route('**raw.githubusercontent.com/**', r => r.abort());
    await page.goto(APP);
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => ({
      autoCardGone: document.getElementById('autoLoadCard').style.display === 'none',
      loadCardShown: document.getElementById('loadCard').style.display !== 'none',
      hasBooks: document.getElementById('commonBookRow').children.length > 0
    }));
    check('a first-ever, fully offline start reaches book selection without the manual picker',
      state.autoCardGone === true && state.loadCardShown === false && state.hasBooks === true,
      JSON.stringify(state));
    await context.close();
  }

  // ---- Priority 4: a Registry fetch that returns something invalid also falls back ----
  {
    const { context, page } = await newSandboxedPage(browser);
    await page.route('**raw.githubusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'this is not a library file at all' }));
    await page.goto(APP);
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => ({
      loadCardShown: document.getElementById('loadCard').style.display !== 'none',
      hasBooks: document.getElementById('commonBookRow').children.length > 0
    }));
    check('an invalid Registry response falls back to the bundled Library, not the manual picker',
      state.loadCardShown === false && state.hasBooks === true, JSON.stringify(state));
    await context.close();
  }

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log('\n' + results.length + ' checks, ' + failed + ' failed');
  process.exit(failed);
})();
