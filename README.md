# Simple Minutes

A phone-sized logger for a regular singing: page numbers only, no leader names, no officers,
no sessions. Open it, pick a book, and tap numbers on a keypad as songs are called.

One HTML file, plus a bundled copy of the shared tunebook library for guaranteed offline use
(see below). Nothing to install, no server, no build step.

## Part of the Sing Loud Suite

| App | What it does |
|---|---|
| [**Minutes**](https://github.com/singlouddotorg/minutes) | Log a singing as it happens, then turn that log into publishable minutes. |
| [**Tunebooks**](https://github.com/singlouddotorg/tunebooks) | Curate the shared tunebook data — editions, page indexes, Level 3 scholarly files. |
| [**Simple Minutes**](https://github.com/singlouddotorg/simple-minutes) | A phone-sized logger: page numbers only, no names. Its files import straight into Minutes. |
| [**Tunebook Registry**](https://github.com/singlouddotorg/tunebook-registry) | The published tunebook data the others read. |

## What it is for

The deliberately narrow case: a weeknight sing where somebody wants a record of what was
sung, and nobody is going to type names into a phone all evening. It writes a real
[Schema 5](https://github.com/singlouddotorg/minutes/blob/main/SCHEMA-5.md) Singing Record — the same format the full
Minutes app uses — so a night's log opens straight into Minutes for compiling into
publishable minutes.

Because it records no leader names, Minutes notices that on import and writes the minutes as
prose about **what was sung** rather than "the leader" once per song. That is automatic;
nothing has to be configured on either side.

## Using it

1. Open `index.html` on the phone.
2. Fill in event, date and location once, and pick a songbook.
3. Optionally set **expected break times** — the clock turns red and pulses from five
   minutes before each one until two minutes after, so a break doesn't slip past while
   you're heads-down logging.
4. Optionally tick **keep the screen awake**, so the phone doesn't sleep mid-singing.
5. Tap the number of each song as it is called. `T` and `B` for top and bottom pages.
6. **Break** marks a recess. **Download CSV** or **Copy CSV** when the singing ends.

The current time sits beside the page number you're typing, at the same size, so you can
check it without leaving the app.

## What it knows, beyond the keypad

A few things happen automatically, from the same shared tunebook data the rest of the Suite
uses — nothing to turn on, nothing to configure:

- **Top and bottom pages.** When a page number belongs to two different songs printed one
  above the other, typing the number alone doesn't guess which one was meant — it prompts
  "tap T or B," and logs whichever one is actually picked.
- **Already logged today.** Tapping a page that's already been logged once this singing
  flags it ("Already logged once today") instead of silently recording it again, so an
  accidental repeat is caught in the moment rather than found later in the minutes.
- **Numbers the book doesn't recognize.** Typing a number the book's index has no song at
  all — a mistyped page, or one that's genuinely blank — doesn't get accepted quietly; it
  takes a second tap of Done ("Add anyway") to log it, so a typo doesn't slip into the
  record unnoticed.
- **Pages that don't fit a plain number.** A few books number some of their pages outside
  the usual page-plus-T/B pattern — roman numerals in the front matter, a lettered appendix
  series, even two different songs sharing one printed number (so guessing which one was
  meant could log the wrong song entirely). Any such book shows an "OTHER" badge next to its
  own; tapping it turns the keypad itself into a numbered list of those real pages to choose
  from — Back and Next if there's more than one page of them — so they're just as loggable
  as an ordinary page, with the exact page as printed, never a guessed or simplified one.

## Where the songbook data comes from

On opening, the app first tries fetching `tunebook-library.js` from the
[Tunebook Registry](https://github.com/singlouddotorg/tunebook-registry), so it has the current book list when a
connection is available. If that fails for any reason — no signal at the venue, a blocked
connection, a privacy extension, or simply the very first time this tool is ever opened —
it falls back to the copy of `tunebook-library.js` bundled right beside `index.html`, with
no picker or prompt in the way. The manual file picker is a last resort, for the rare case
where even the bundled copy is somehow missing.

That fetch is the app's only network request. The library file — bundled or fetched — is
never executed as code; it's read strictly as data, the same safeguard Tunebooks uses.

## Everything stays on the phone

No singing data is ever sent anywhere — the log saves to browser storage as you go, and no
file is written until you actually tap Download or Copy. When online, Simple Minutes may
make a single, read-only request for the current Tunebook Library, described above.

## Tests

```bash
cd tests/live && npm install playwright
node t6-simple-minutes-clock.js     # the clock
node t7-break-warnings.js           # break warnings and the wake lock
node gen-simple-minutes-fixture.js  # regenerate the export fixture Minutes tests against
```

The fixture that last script produces is what the Minutes repository uses to test the import
contract between the two apps. If this app's export format changes, regenerate it here and
copy it across.
