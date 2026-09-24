import { chromium } from 'playwright-core';

// Centric view's Location metric groups by real great-circle distance (see
// centricLocationRing/haversineKm in app.js) in a 5x geometric progression
// -- 5 / 25 / 100 / 500 km -- tight enough at ring 1 to actually mean "the
// same locality," not just "somewhere in the region."
//
// Each fixture is placed by a PURE LATITUDE offset from the center (same
// longitude): with no longitude change, haversine's central angle reduces
// exactly to the latitude delta itself (a = sin²(Δlat/2), so
// atan2(sqrt(a),sqrt(1-a)) = Δlat/2 exactly), so distance = R * Δlat
// (radians) precisely -- no approximation error to worry about, unlike a
// real named city pair.
function person(id, name, year, loc) {
  return {
    id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    locations: loc ? [loc] : [],
  };
}
const CENTER_LAT = 42.3601, CENTER_LON = -71.0589; // Boston, Massachusetts
const R = 6371;
function latOffsetFor(km) {
  return CENTER_LAT + (km / R) * (180 / Math.PI);
}

const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, { text: 'Boston, Massachusetts', lat: CENTER_LAT, lon: CENTER_LON }));
// Exactly 2 km away -- inside the <5 km band.
add(person('band1', 'Two Km Away', 1975, { text: '~2 km away', lat: latOffsetFor(2), lon: CENTER_LON }));
// Exactly 12 km away -- inside the 5-25 km band.
add(person('band2', 'Twelve Km Away', 1978, { text: '~12 km away', lat: latOffsetFor(12), lon: CENTER_LON }));
// Exactly 50 km away -- inside the 25-100 km band.
add(person('band3', 'Fifty Km Away', 1980, { text: '~50 km away', lat: latOffsetFor(50), lon: CENTER_LON }));
// Exactly 225 km away -- inside the 100-500 km band.
add(person('band4', 'Far Away', 1982, { text: '~225 km away', lat: latOffsetFor(225), lon: CENTER_LON }));
// ~16,000 km away -- inside the 500+ km band.
add(person('band5', 'Syd Farthest', 1985, { text: 'Sydney, Australia', lat: -33.8688, lon: 151.2093 }));
// No coordinates at all -- must land in the same outermost ring as band5.
add(person('noLoc', 'No Location', 1990, null));

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

  console.log('=== Ring labels: 5 real-distance bands, 5x geometric progression ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  console.log('labels:', JSON.stringify(labels));
  for (const expected of ['< 5 km', '5–25 km', '25–100 km', '100–500 km', '500+ km / unknown']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got: ${JSON.stringify(labels)}`);
  }
  if (labels.length !== 5) throw new Error(`Expected exactly 5 ring labels, got ${labels.length}`);
  console.log('Confirmed: all 5 distance-band ring labels present.');

  const ringOf = async (id) => page.evaluate((id) => {
    const center = document.querySelector('.centric-center-card').getBoundingClientRect();
    const el = document.querySelector(`[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - (center.left + center.width / 2);
    const dy = (r.top + r.height / 2) - (center.top + center.height / 2);
    return Math.hypot(dx, dy);
  }, id);

  console.log('\n=== Ring order: <5km < 5-25km < 25-100km < 100-500km < 500+km/unknown ===');
  const d = {};
  for (const id of ['band1', 'band2', 'band3', 'band4', 'band5', 'noLoc']) {
    d[id] = await ringOf(id);
  }
  console.log('distances:', JSON.stringify(d));
  if (!(d.band1 < d.band2 && d.band2 < d.band3 && d.band3 < d.band4 && d.band4 < d.band5)) {
    throw new Error(`Expected strictly increasing radii band1 < band2 < band3 < band4 < band5, got ${JSON.stringify(d)}`);
  }
  if (Math.abs(d.band5 - d.noLoc) > 2) {
    throw new Error(`Expected the farthest real distance and "no coordinates at all" to share the outermost ring, got ${d.band5} vs ${d.noLoc}`);
  }
  console.log('Confirmed: 5-band ordering correct by real km, and "no coordinates" shares the outermost ring with "genuinely far."');

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
