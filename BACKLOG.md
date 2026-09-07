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

## Location history: date ranges

A person now has an ordered `locations` list (index 0 = "current") plus a
separate `birthLocation`, replacing the old singular `location` field (see
`locationsOf`/`currentLocationOf` in `app.js`). Order alone decides which
location is "current" -- set by dragging a row to the top of the
Location(s) list on the Add/Edit form (grip handle, `setupLocationRowDrag`
in `app.js`).

Deliberately deferred, to be added as a follow-up: a date range (with a
calendar-icon picker) per location, shown alongside each row and in the
Person View's Locations history section.

## Contact field: phone formatting needs the CDN to load

The single free-text `contact` field (Add/Edit form, `formatPhoneLive` /
`reformatPhoneField` in `app.js`) live-formats digits as you type using
libphonenumber-js (loaded from jsdelivr in index.html) -- a leading "+"
plus country calling code gets that country's own grouping (e.g.
"+44 20 7946 0958"), a plain domestic number defaults to US grouping. It
shows a quick "+ @gmail.com" button once it looks like an email being
typed instead.

If the CDN script fails to load (offline, blocked), it falls back to
`groupPhoneDigitsFallback` -- crude, always-US-style `XXX-XXX-XXXX`
grouping with no real per-country awareness. Same fallback applies to the
Person View card's `tel:` link (`contactHref`): normally a properly
normalized E.164 number from libphonenumber-js, otherwise just digits and
a leading "+" stripped of other punctuation.
