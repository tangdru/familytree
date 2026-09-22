import { chromium } from 'playwright-core';

// Regression test for packAroundCentroid (Globe View's replacement for the
// old straight-line fanOutRow): when a cluster of people sharing an exact
// (or near-exact) coordinate is resolved into individual cards, they're
// arranged in a ring -- or, past ~13 people, an outward spiral -- around
// their shared spot, and none of their cards should ever overlap.
//
// The specific bug this guards against: computing a ring's radius from
// ARC length between adjacent points (circumference / n) rather than
// straight-line CHORD distance undershoots badly at small n -- for a pair
// (n=2) it placed them only ~64% of the intended spacing apart, since a
// diameter is 2/pi of a semicircle's arc length. That's exactly what
// overlapping cards looked like in practice.
function rectsOverlap(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function packedGroupOverlaps(page, n) {
  const loc = { text: 'Tacoma, Washington', lat: 47.2529, lon: -122.4443 };
  const people = {};
  for (let i = 1; i <= n; i++) {
    people['p' + i] = {
      id: 'p' + i, name: 'Person ' + i, birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
      birthLocation: loc,
    };
  }
  await page.evaluate((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'globe');
  await page.waitForTimeout(1200);
  // Rotate+zoom onto the shared cluster via its own badge, exactly the way
  // a real user would resolve it, until every member renders individually.
  for (let i = 0; i < 8; i++) {
    const badge = await page.$('.map-cluster');
    if (!badge) break;
    const box = await badge.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(300);
  const cardCount = await page.evaluate(() => document.querySelectorAll('.map-card').length);
  if (cardCount !== n) throw new Error(`Expected all ${n} people to resolve into individual cards, got ${cardCount}`);
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
    const result = await packedGroupOverlaps(page, n);
    if (result.overlap) throw new Error(`Expected no overlap among ${n} packed cards, but cards ${result.i} and ${result.j} overlap: ${JSON.stringify(result.rects[result.i])} vs ${JSON.stringify(result.rects[result.j])}`);
    console.log(`Confirmed: all ${n} cards render with no pairwise overlap.`);
  }

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
