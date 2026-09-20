# Family Tree

A dynamic, interactive family tree — built as a web app so anyone in the
family can browse it, add people, and keep it up to date, without needing
to install anything.

**Live site:** https://tangdru.github.io/familytree/

## What it does

- **Four ways to look at the same tree**
  - **Traditional Tree** — the classic generation-by-generation layout, parents above children.
  - **Chronological Tree** — everyone lined up by birth year, with a year ruler along the edge.
  - **Zodiac Tree** — grouped into columns by Chinese zodiac sign.
  - **Centric View** — concentric rings around one person, showing everyone else's age or location relative to them. Tap a ring member to recenter on them.
- **Full profiles** — tap anyone's card to see their photo, dates, contact info, and how they connect to the rest of the family. Swipe through profiles without going back to the tree each time.
- **Zodiac-adjusted birthdays** — for family members whose documented birthday isn't quite right, enter both the documented date and their Chinese zodiac sign; the profile shows both, corrected against each other.
- **Couples share a card** — married couples/partners show side by side in Traditional and Chronological view.
- **Locations over time** — track everywhere someone has lived, with date ranges, not just their current city.
- **Search and pan/zoom** — find anyone by name, or drag/pinch around a large tree, with a one-tap "fit everyone back on screen" button.
- **A guided walkthrough** — new visitors get a short tour of the main controls automatically (replayable any time from the Help button).

## Is my data shared with everyone?

The live site above is connected to a shared database (via
[Supabase](https://supabase.com)), so anyone using that link is looking at
and editing the **same** tree, live — that's the point, so the whole
family can pitch in. There's no login, so treat the link itself as the
access control: only share it with people you're fine having edit access.

If you'd rather have your own separate, private tree instead, run your
own copy (see below) and leave `config.js`'s keys blank — it'll save to
your own browser only, with nothing shared.

## Running your own copy

This is a plain HTML/CSS/JS site — no build step, no framework, no
`npm install` required to just open it.

1. Clone the repo and open `index.html` in a browser (or serve the folder
   with any static file server).
2. By default it saves to your browser's local storage only.
3. To sync across your own devices instead, create a free project at
   [supabase.com](https://supabase.com), run the SQL in
   `supabase-schema.sql` in its SQL editor, then paste your project's URL
   and anon key into `config.js` (see the comment at the top of that file
   for exact steps).

The `tests/` folder has a full Playwright regression suite
(`node tests/test_*.mjs`) covering the tree views, person editing, and the
walkthrough — handy if you're poking at the code and want to make sure
nothing broke.

## Also in this repo

[`ukulele/`](ukulele/) is an unrelated side project hosted alongside the
family tree: a browser-based baritone ukulele practice coach (chord charts,
tuner, rhythm feedback). See its own README for details.

## Built with

Vanilla JavaScript, HTML, and CSS — plus [Supabase](https://supabase.com)
for optional shared storage, [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js)
for contact formatting, and [Driver.js](https://driverjs.com) for the
first-time walkthrough.
