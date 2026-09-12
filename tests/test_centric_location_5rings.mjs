import { chromium } from 'playwright-core';

// Real coordinates (lat, lon), so the ring bucketing exercises the actual
// haversine distance calculation (see haversineDistanceKm/centricLocationRing
// in app.js) rather than the old text-heuristic tiers. Distances from
// Boston are well-known approximations:
//   Boston -> Cambridge   ~3 mi   (ring 1: 0-50 mi)
//   Boston -> New York    ~190 mi (ring 2: 50-500 mi)
//   Boston -> Los Angeles ~2,600 mi (ring 3: 500-3,000 mi)
//   Boston -> Sydney      ~9,950 mi (ring 4: 3,000+ mi)
function person(id, name, year, text, lat, lon) {
  const locations = text ? [{ text, lat: lat ?? null, lon: lon ?? null }] : [];
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, 'Boston, Massachusetts', 42.3601, -71.0589));
add(person('ring1', 'Neary Nearby', 1975, 'Cambridge, Massachusetts', 42.3736, -71.1097));
add(person('ring2', 'Mia Midrange', 1978, 'New York, New York', 40.7128, -74.0060));
add(person('ring3', 'Fara Faraway', 1980, 'Los Angeles, California', 34.0522, -118.2437));
add(person('ring4', 'Sydney South', 1982, 'Sydney, Australia', -33.8688, 151.2093));
add(person('noLoc', 'No Location', 1990, ''));
// A location typed by hand (or saved before Nominatim-backed coordinates
// existed) has no lat/lon -- can't participate in the real-distance ring,
// so it lands in "Unknown distance" alongside noLoc.
add(person('unknownCoords', 'Uncharted Utah', 1988, 'Somewhere, Nowhere', null, null));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);

  console.log('=== Ring labels: 5 tiers, both miles and km shown together ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  console.log('labels:', JSON.stringify(labels));
  for (const expected of ['0–50 mi (0–80 km)', '50–500 mi (80–800 km)', '500–3,000 mi (800–4,800 km)', '3,000+ mi (4,800+ km)', 'Unknown distance']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got: ${JSON.stringify(labels)}`);
  }
  if (labels.length !== 5) throw new Error(`Expected exactly 5 ring labels, got ${labels.length}`);
  console.log('Confirmed: all 5 location ring labels present, each showing both mi and km.');

  const ringOf = async (id) => page.evaluate((id) => {
    const center = document.querySelector('.centric-center-card').getBoundingClientRect();
    const el = document.querySelector(`[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - (center.left + center.width / 2);
    const dy = (r.top + r.height / 2) - (center.top + center.height / 2);
    return Math.hypot(dx, dy);
  }, id);

  console.log('\n=== Ring order: 0-50mi < 50-500mi < 500-3000mi < 3000+mi < unknown ===');
  const d = {};
  for (const id of ['ring1', 'ring2', 'ring3', 'ring4', 'noLoc', 'unknownCoords']) {
    d[id] = await ringOf(id);
  }
  console.log('distances:', JSON.stringify(d));
  if (!(d.ring1 < d.ring2 && d.ring2 < d.ring3 && d.ring3 < d.ring4 && d.ring4 < d.noLoc)) {
    throw new Error(`Expected strictly increasing radii ring1 < ring2 < ring3 < ring4 < unknown, got ${JSON.stringify(d)}`);
  }
  if (Math.abs(d.noLoc - d.unknownCoords) > 2) {
    throw new Error(`Expected noLoc and unknownCoords (no usable coordinates either way) in the same outermost ring, got ${d.noLoc} vs ${d.unknownCoords}`);
  }
  console.log('Confirmed: real-distance ordering correct, no-location and no-coordinates share the outermost "Unknown distance" ring.');

  console.log('\n=== Switching Age <-> Location shows/hides the 5th ring (element itself persists, see ensureCentricGridElements) ===');
  const countVisibleRings = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]')).filter(c => c.style.display !== 'none').length
  );
  await page.click('.centric-metric-btn[data-metric="age"]');
  await page.waitForTimeout(700);
  const ageRingCount = await countVisibleRings();
  if (ageRingCount !== 4) throw new Error(`Expected 4 visible rings in Age metric, got ${ageRingCount}`);
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const locRingCount = await countVisibleRings();
  if (locRingCount !== 5) throw new Error(`Expected 5 visible rings in Location metric, got ${locRingCount}`);
  console.log('Confirmed: Age shows 4 rings, Location shows 5.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
