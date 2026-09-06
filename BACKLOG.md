# Backlog

## Parent couple card: more than 2 parents / more than 1 spouse

The Person View's parent couple card (see the "vertical navigation" comment
block in `app.js`) currently assumes at most two recorded parents per person
and shows a person's *other* spouses only via the small avatar row beneath
the card. Revisit when:

- A person can have more than one spouse/partner recorded — the couple
  card, and the "other" spouse avatars it excludes, need a way to represent
  more than one prior/concurrent relationship clearly (which one is "the"
  co-parent for a given child?).
- A person can have more than two parents recorded — the couple card layout
  (two equal-size members side by side) needs to generalize to N members, or
  fall back to a different layout past two.
