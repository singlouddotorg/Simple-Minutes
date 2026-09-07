// Resolves the file a live test drives, in whichever layout it finds itself.
//
// These scripts run in two real places: the single working tree, where every app sits
// together (`simple-minutes/simple-minutes.html`, `tunebook-library.js` at the top), and
// each app's own generated repo, where that app is at the root and the other apps are not
// present at all. Rather than keep two copies of every test - which is precisely the
// duplication this project keeps getting bitten by - each script asks for a file by name
// and gets whichever real path exists.
//
// Returning null rather than throwing is deliberate: a test that legitimately cannot run
// in one layout (a cross-app check, in a repo that holds only one app) should say so and
// skip, not fail as though the app were broken.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function firstExisting(...candidates){
  for (const rel of candidates){
    const p = path.resolve(ROOT, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  ROOT,
  firstExisting,
  // Each app, in working-tree position first, then own-repo position.
  // Each app is named for itself in the shared working tree, where three files cannot all
  // be called index.html - and is index.html in its own repository, so GitHub Pages serves
  // it at the repo root and a downloaded folder opens by double-clicking the obvious file.
  minutesApp:       () => firstExisting('minutes.html', 'index.html'),
  tunebooksApp:     () => firstExisting('tunebooks.html', 'index.html'),
  simpleMinutesApp: () => firstExisting('simple-minutes/simple-minutes.html', 'simple-minutes.html', 'index.html'),
  // The tunebook library: a real file beside every app that loads it (Simple Minutes
  // included, as of the 2026-09-06c revised review's offline-fallback fix), falling back to
  // the tests' own fixture copy only if that's somehow absent.
  tunebookLibrary:  () => firstExisting('tunebook-library.js', 'tests/live/fixtures/tunebook-library.js'),
  samples:          () => firstExisting('samples')
};
