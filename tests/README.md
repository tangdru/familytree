# Tests

Playwright-driven browser tests for the family tree app. Not unit tests —
each script boots a real headless Chromium, loads the app with seeded
`localStorage` data, and drives the UI.

## Prerequisites

- A local static server serving the repo root on port 8934:
  `python3 -m http.server 8934 --directory /home/user/familytree`
- Playwright's Chromium at `/opt/pw-browsers/chromium` (pre-installed in the
  Claude Code web sandbox).

## Running

Run a single test:

```
node tests/test_centric_view.mjs
```

Run everything:

```
for f in tests/test_*.mjs; do node "$f" || echo "FAIL: $f"; done
```

Each test exits non-zero (via `throw` or `process.exit(1)`) on failure and
prints diagnostic `console.log` output either way.

## Triage before running everything

Most changes only touch one feature area. Before running the full suite,
use `tests/triage_tests.sh` to see which tests are actually relevant to the
current uncommitted diff:

```
bash tests/triage_tests.sh
```

It recommends one of:
- **skip entirely** — the diff is text/copy-only in `index.html` (no tags,
  ids, classes, or attributes changed), so no existing test can observe it.
- **run this subset** — the diff touches specific functions/ids/classes;
  it greps the test files for those identifiers and lists only the matches.
- **run the full suite** — the diff touches core shared logic (card
  rendering, the centric ring math, swipe/drag commit, view-mode
  rendering) where a change in one view has historically broken another.

## History

This suite was pruned from 79 files down to the 51 here — the removed
files were one-off debug/investigation scripts with no actual pass/fail
assertions (just `console.log` + `browser.close()`), including several
that had been silently broken for a while and were being permanently
ignored as "known failures." Every file that remains has real assertions
and is expected to pass.
