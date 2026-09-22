import { chromium } from 'playwright-core';

// Regression test for Globe View's decluttering of individually-shown
// cards: computeGlobeForceLayout (a persistent d3-force simulation) keeps
// any two cards from overlapping, whether they share an exact coordinate
// (an address collision) or are merely close enough that their card
// FOOTPRINTS overlap even though clusterGlobePoints didn't merge them into
// one badge (real, distinct nearby addresses -- see renderGlobeFrame).
//
// Bugs this guards against, both found in practice:
// 1. computeGlobeForceLayout's forceCollide originally used d3-force's own
//    default iteration count (1), which asymptotically approaches full
//    separation for many people sharing one exact point but never quite
//    reaches it within the handful of frames one cluster-click animation
//    actually renders -- 15 people at one address settled with several
//    pairs still slightly overlapping. Raising forceCollide's iteration
//    count (not the number of simulation ticks, which barely mattered)
//    to GLOBE_FORCE_COLLIDE_ITERATIONS fixed it.
// 2. `.map-card:hover` and the base `.person-card:hover` rule in style.css
//    have EQUAL CSS specificity (one class + one pseudo-class each), and
//    since `.person-card:hover` is declared later in the file, it silently
//    won every tie -- meaning hovering (or, on a touchscreen, tapping and
//    leaving a lingering :hover) any globe card snapped it back to full,
//    unscaled size, swallowing its neighbors. Fixed by giving the globe
//    rule higher specificity (`.map-card.person-card:hover`).
function rectsOverlap(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function loadPeopleIntoGlobe(page, people) {
  await page.evaluate((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'globe');
  await page.waitForTimeout(1200);
}

async function resolveClusterFully(page, maxClicks = 8) {
  // Rotate+zoom onto the shared cluster via its own badge, exactly the way
  // a real user would resolve it, until every member renders individually.
  // Returns how many clicks it actually took.
  let clicksUsed = 0;
  for (let i = 0; i < maxClicks; i++) {
    const badge = await page.$('.map-cluster');
    if (!badge) break;
    const box = await badge.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    clicksUsed++;
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(300);
  return clicksUsed;
}

async function checkNoOverlap(page, expectedCount) {
  const cardCount = await page.evaluate(() => document.querySelectorAll('.map-card').length);
  if (cardCount !== expectedCount) throw new Error(`Expected all ${expectedCount} people to resolve into individual cards, got ${cardCount}`);
  const rects = await page.evaluate(() => [...document.querySelectorAll('.map-card')].map(c => c.getBoundingClientRect()));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) return { overlap: true, i, j, rects };
    }
  }
  return { overlap: false };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  for (const n of [2, 3, 6, 15]) {
    console.log(`\n=== ${n} people at the exact same coordinate pack apart without overlapping ===`);
    const people = {};
    const loc = { text: 'Tacoma, Washington', lat: 47.2529, lon: -122.4443 };
    for (let i = 1; i <= n; i++) {
      people['p' + i] = { id: 'p' + i, name: 'Person ' + i, birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: loc };
    }
    await loadPeopleIntoGlobe(page, people);
    await resolveClusterFully(page);
    const result = await checkNoOverlap(page, n);
    if (result.overlap) throw new Error(`Expected no overlap among ${n} packed cards, but cards ${result.i} and ${result.j} overlap: ${JSON.stringify(result.rects[result.i])} vs ${JSON.stringify(result.rects[result.j])}`);
    console.log(`Confirmed: all ${n} cards render with no pairwise overlap.`);
  }

  console.log('\n=== Real, DISTINCT nearby addresses that resolve out of a badge still don\'t overlap ===');
  // Federal Way/Tacoma/Kent/Puyallup, WA -- close enough on screen to start
  // clustered under one badge, but genuinely different coordinates (unlike
  // the exact-address cases above). Once resolved into individual groups,
  // each group's own card footprint (wider than GLOBE_CLUSTER_PIXEL_RADIUS,
  // see renderGlobeFrame) can still overlap a DIFFERENT group's card unless
  // the force layout declutters across group boundaries, not just within
  // one -- the actual bug reported in practice.
  const realPeople = {
    p1: { id: 'p1', name: 'Anh Tu Ngo', birthDate: '1940-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Federal Way, Washington', lat: 47.3223, lon: -122.3126 } },
    p2: { id: 'p2', name: 'Manh Hue Tang', birthDate: '1940-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Tacoma, Washington', lat: 47.2529, lon: -122.4443 } },
    p3: { id: 'p3', name: 'Cuong Chi Tang', birthDate: '1965-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Tacoma, Washington', lat: 47.2529, lon: -122.4443 } },
    p4: { id: 'p4', name: 'Holly Tang Phan', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Kent, Washington', lat: 47.3809, lon: -122.2348 } },
    p5: { id: 'p5', name: 'Kyle Tang Phan', birthDate: '1992-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Kent, Washington', lat: 47.3809, lon: -122.2348 } },
    p6: { id: 'p6', name: 'Binh Wong', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], birthLocation: { text: 'Puyallup, Washington', lat: 47.1854, lon: -122.2929 } },
  };
  await loadPeopleIntoGlobe(page, realPeople);
  const clicksUsed = await resolveClusterFully(page);
  const realResult = await checkNoOverlap(page, 6);
  if (realResult.overlap) throw new Error(`Expected no overlap among 6 real nearby-address cards, but cards ${realResult.i} and ${realResult.j} overlap: ${JSON.stringify(realResult.rects[realResult.i])} vs ${JSON.stringify(realResult.rects[realResult.j])}`);
  console.log(`Confirmed: 6 real, distinct nearby addresses resolve with no pairwise overlap (took ${clicksUsed} click(s)).`);

  console.log('\n=== A real, merely-close (not identical) cluster resolves in just a couple of taps ===');
  // The reported complaint: the old flat GLOBE_CLUSTER_ZOOM_FACTOR made a
  // real cluster of distinct-but-nearby people take many taps to resolve.
  // The per-cluster zoom-to-fit math (see the badge click handler in
  // renderGlobeFrame) computes the zoom this SPECIFIC cluster needs, so it
  // should resolve well before exhausting the same 8-click budget above.
  if (clicksUsed > 4) throw new Error(`Expected a real nearby-but-distinct cluster to resolve within a few taps, took ${clicksUsed}`);
  console.log(`Confirmed: resolved in ${clicksUsed} tap(s), not a long series of small zooms.`);

  console.log('\n=== A hovered/tapped card keeps its scaled size, not the base .person-card:hover size ===');
  // The CSS specificity bug: the mouse is left resting exactly on the last
  // clicked cluster's position (as it would be after a real tap on a
  // touchscreen, where :hover can linger), which is exactly where this bug
  // showed up in practice -- style.css originally let bare .person-card:hover
  // (declared later in the file, same specificity) win over .map-card:hover,
  // snapping the hovered card back to full, unscaled size.
  const beforeHoverRect = await page.evaluate(() => document.querySelector('.map-card').getBoundingClientRect());
  const hoveredRect = await page.evaluate(() => {
    const el = document.querySelector('.map-card');
    const r = el.getBoundingClientRect();
    return r;
  });
  const cardCenter = { x: hoveredRect.x + hoveredRect.width / 2, y: hoveredRect.y + hoveredRect.height / 2 };
  await page.mouse.move(cardCenter.x, cardCenter.y);
  await page.waitForTimeout(200);
  const duringHoverRect = await page.evaluate(() => document.querySelector('.map-card').getBoundingClientRect());
  const grewALot = duringHoverRect.width > beforeHoverRect.width * 1.5;
  if (grewALot) throw new Error(`Expected a hovered globe card to keep its scaled-down size (~${beforeHoverRect.width.toFixed(0)}px), but it grew to ${duringHoverRect.width.toFixed(0)}px -- the .person-card:hover specificity bug`);
  console.log(`Confirmed: hovering a card keeps it at its scaled size (${beforeHoverRect.width.toFixed(0)}px -> ${duringHoverRect.width.toFixed(0)}px, just the hover lift).`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
