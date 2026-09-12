# Backlog

## Parent couple card: more than 2 parents / more than 1 spouse

The Person View's parent couple card (see the "vertical navigation" comment
block in `app.js`) shows at most two people side by side. Both underlying
data fields already support more:

- A person can record any number of spouses/partners, each tagged
  `current` or `former` (`spouseStatus` on the person record; see
  `spouseStatusOf`/`partnerIdOf`). The couple card and step-parent
  inference always pick the first `current` one — additional spouses
  (current or former) are reachable via the small avatar row beneath the
  card and the Spouses relation list, just never auto-paired on the card.
- A person can record any number of parents via the unified "Parent(s)"
  chip field. The Parents relation list shows all of them; the couple card
  still only ever shows the *first two* recorded (`parentIdsOf` caps at
  2) — intentional per the couple card's two-person layout, not a bug.

Revisit if the couple card itself should ever show more than two members
at once (would need its own layout redesign), or if `partnerIdOf` should
handle multiple simultaneous `current` spouses (e.g. picking among them)
rather than just the first.

## Location history: date ranges (done) + migration map (still deferred)

A person has an ordered `locations` list (index 0 = "current") plus a
separate `birthLocation`, replacing the old singular `location` field (see
`locationsOf`/`currentLocationOf`/`birthLocationTextOf` in `app.js`). Order
alone decides which location is "current" -- set by dragging a row to the
top of the Location(s) list on the Add/Edit form (grip handle,
`setupLocationRowDrag`).

Each location entry (and `birthLocation`) is `{text, lat, lon, startDate,
endDate}` -- lat/lon are only known once a Nominatim suggestion has been
picked (see `setupLocationAutocomplete`'s `onPick`); startDate/endDate are
plain 4-digit year strings (or null), entered via the calendar-icon
button's year `<select>` per Start/End on each row (`buildLocationDateGroup`)
-- deliberately year-only, not a full date: family history rarely knows
more precision than that, and it keeps this a genuinely different kind of
field from Born/Died (which drives real computation elsewhere -- age, sort
order, the Chronological Tree, zodiac correction -- and so stays on a
native, complete date input). `birthLocation` gets the same calendar-icon
popover as each Location(s) row (`setupBirthLocationDates`, since it's a
single static field rather than part of the repeatable list) -- opening it
for the first time on a person with a known Documented birthday assumes
that year for Start, since a birth location's start is virtually always
the birth year itself, though it's still just a starting point and can be
changed.

Deliberately deferred, to be added as a follow-up: an actual map view that
animates a person's (or the whole family's) movement between locations
over time, using these now-collected coordinates + dates. None of the
existing views (Traditional/Chronological/Zodiac/Centric) are geographic,
so this needs its own real-world map projection and a timeline
scrubber/playback control -- a bigger, separate design pass.

## Contact field: phone formatting needs the CDN to load

Each row in the repeatable Contact(s) list (Add/Edit form, `formatPhoneLive` /
`reformatPhoneField` in `app.js` -- see `addContactRow`) live-formats digits as you type using
libphonenumber-js (loaded from jsdelivr in index.html) -- a leading "+"
plus country calling code gets that country's own grouping (e.g.
"+44 20 7946 0958"); a plain domestic number (no "+") defaults to
whichever country `guessCountryFromLocationText` recognizes from the
person's current location (falling back to birth location, then plain US)
-- see `COUNTRY_NAME_TO_ISO` for the (non-exhaustive) list of country
names it knows. It shows a quick "+ @gmail.com" button once it looks like
an email being typed instead.

If the CDN script fails to load (offline, blocked), it falls back to
`groupPhoneDigitsFallback` -- crude, always-US-style `XXX-XXX-XXXX`
grouping with no real per-country awareness. Same fallback applies to the
Person View card's `tel:` link (`contactHref`): normally a properly
normalized E.164 number from libphonenumber-js, otherwise just digits and
a leading "+" stripped of other punctuation.
