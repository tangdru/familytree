#!/bin/bash
# Prints which test files are relevant to the current uncommitted changes
# in the familytree repo, so we don't run the full suite for small edits.
#
# Usage: ./triage_tests.sh   (run from anywhere; assumes repo at /home/user/familytree)

set -euo pipefail
REPO=/home/user/familytree
TESTS_DIR="$(dirname "$0")"

cd "$REPO"
DIFF=$(git diff HEAD -- index.html app.js style.css)

if [ -z "$DIFF" ]; then
  echo "No uncommitted changes in index.html/app.js/style.css."
  exit 0
fi

CHANGED_FILES=$(git diff HEAD --name-only -- index.html app.js style.css)
echo "Changed files: $CHANGED_FILES"
echo

# Core shared functions/areas: touching these has a wide, hard-to-predict
# blast radius (used across multiple views), so recommend the full suite.
CORE_PATTERN='buildCard|animateCentricGrid|openViewModal|renderTree|centricRing|swipeCommit|onDragMove|onDragStart|viewModeSelect|renderCentric|renderChrono|renderZodiac|renderTraditional'
if echo "$DIFF" | grep -qE "^\+.*($CORE_PATTERN)|^-.*($CORE_PATTERN)"; then
  echo "TOUCHES CORE SHARED LOGIC -> recommend running the FULL suite."
  exit 0
fi

# Pure text/content-only change in index.html: word-level diff so a line
# that's rewritten (tags unchanged, only prose inside them differs) isn't
# mistaken for a structural change just because the whole line was replaced.
if [ "$CHANGED_FILES" = "index.html" ]; then
  WORDDIFF=$(git diff HEAD --word-diff-regex='<[^>]+>|[A-Za-z0-9_-]+' --word-diff=plain -- index.html)
  STRUCTURAL=$(echo "$WORDDIFF" | grep -oE '\[-[^]]*-\]|\{\+[^}]*\+\}' | grep -E '<|^\{?\[?-?\+?(id|class|onclick|hidden|href|src)$' || true)
  if [ -z "$STRUCTURAL" ]; then
    echo "Text-only content change, no tags/ids/classes touched."
    echo "RECOMMENDATION: skip test run, just screenshot the affected section."
    exit 0
  fi
fi

# Otherwise: extract candidate identifiers (ids, function names, class names)
# from the diff's added/removed lines, then find test files referencing them.
IDENTIFIERS=$(echo "$DIFF" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -oE "id=\"[A-Za-z0-9_-]+\"|getElementById\('[A-Za-z0-9_-]+'\)|els\.[A-Za-z0-9_]+|function [A-Za-z0-9_]+|class=\"[A-Za-z0-9_ -]+\"|\.[A-Za-z][A-Za-z0-9_-]{3,}" \
  | grep -oE '[A-Za-z][A-Za-z0-9_-]{3,}' | sort -u)

if [ -z "$IDENTIFIERS" ]; then
  echo "Could not extract identifiers from diff -- recommend full suite to be safe."
  exit 0
fi

MATCHES=""
for id in $IDENTIFIERS; do
  found=$(grep -lE "\b$id\b" "$TESTS_DIR"/test_*.mjs 2>/dev/null || true)
  if [ -n "$found" ]; then
    MATCHES="$MATCHES
$found"
  fi
done

MATCHES=$(echo "$MATCHES" | sed '/^$/d' | sort -u)

if [ -z "$MATCHES" ]; then
  echo "No existing test references the changed identifiers."
  echo "RECOMMENDATION: no relevant regression tests; verify manually (screenshot/click-through)."
else
  echo "RECOMMENDATION: run just these tests:"
  echo "$MATCHES" | xargs -n1 basename
fi
