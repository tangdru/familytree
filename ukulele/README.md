# Baritone Uke Coach

A browser-based practice companion for baritone ukulele (tuned D G B E, the
same as a guitar's top 4 strings). No build step, no framework, no account —
open `index.html` (served, not `file://`, so the microphone works) and go.

**Live (once merged to main):** `https://tangdru.github.io/familytree/ukulele/`

## What it does

- **Song chart** — paste or upload a [ChordPro](https://www.chordpro.org/chordpro/chordpro-introduction/)-style
  chord chart, or pick one of two bundled demo songs (Amazing Grace, You Are
  My Sunshine). Chords render above the lyrics; tap any chord to see its
  fingering.
- **Baritone chord diagrams** — fingerings are *computed*, not hand-typed:
  each chord symbol is parsed into a root + interval set, and the app
  searches fret positions on the D/G/B/E strings for a valid voicing
  containing the chord's root, third (or sus tone), and — for 7th/6th
  chords — the defining 4th tone. This avoids the common mistake of reusing
  guitar chord shapes as-is, which can silently drop the root when it lived
  on the low E/A strings a baritone doesn't have.
- **Scrolling view** — "Play" starts a Web-Audio-scheduled metronome at the
  song's tempo and auto-scrolls/highlights the chart line by line in sync.
  Tap any line to jump the playback position there. Auto-scroll can be
  toggled off if you just want the beat and manual scrolling.
- **Tuner** — continuous pitch detection (autocorrelation) with a note name,
  cents-off needle, and nearest-open-string hint (D3/G3/B3/E4).
- **Key** — read from the chart's `{key: ...}` directive, or tap "Detect
  from mic" to listen for 6 seconds and estimate the key via a chroma
  histogram + Krumhansl-Schmuckler key-profile correlation.
- **Rhythm Coach** — starts the metronome and listens for your strums
  (energy-flux onset detection), scoring each one against the nearest beat
  (perfect / good / off / miss) with a running on-time % and average timing
  error.

## What it deliberately doesn't do

- **No "name a song and it finds the chords" lookup.** That needs an
  external song/chord database (or real audio fingerprinting, Shazam-style)
  this app doesn't have access to. Bring your own ChordPro chart instead.
- **No pitch-accuracy grading** ("was that the right note"), only *timing*
  feedback — matching played notes to expected pitches would need the chart
  to encode a full melody/tab, not just chords+lyrics.

## Format for your own songs

Plain text, ChordPro-flavored:

```
{title: Song Name}
{artist: Someone}
{key: G}
{tempo: 96}
{time: 4/4}

[G]Some lyrics [D]with chords [Em]inline
{start_of_chorus}
More [C]lyrics [G]here
{end_of_chorus}
```

Blank lines start a new section. Unrecognized `{directives}` are ignored
rather than rejected, so a real-world ChordPro file mostly still works even
if it uses features (tabs, capo, etc.) this app doesn't render.

## Running it

Needs a real HTTP server (mic access requires a secure context — `file://`
won't work):

```
cd ukulele
python3 -m http.server 8000
# open http://localhost:8000
```

## Testing

`smoke_test.mjs` and `smoke_test_mic.mjs` are Playwright scripts (not part
of the served app) that load the page in headless Chromium and click
through song loading, chord diagrams, scrolling playback, and the
mic-gated tuner/rhythm-coach/key-detect flows (using Chromium's fake audio
device). Run a static server first, then:

```
node smoke_test.mjs
node smoke_test_mic.mjs
```
