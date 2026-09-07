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

## Location history: date ranges + drag-to-reorder

A person now has an ordered `locations` list (index 0 = "current") plus a
separate `birthLocation`, replacing the old singular `location` field (see
`locationsOf`/`currentLocationOf` in `app.js`). Order alone decides which
location is "current" for now, set purely by whichever row is first in the
Location(s) list on the Add/Edit form.

Deliberately deferred, to be added as a follow-up:

- A date range (with a calendar-icon picker) per location, shown alongside
  each row and in the Person View's Locations history section.
- Drag-and-drop reordering of the Location(s) rows in the Add/Edit form, so
  "current" can be changed without deleting and re-adding rows.
