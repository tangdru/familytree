import { chromium } from 'playwright-core';

// Centric view's Location metric groups by real great-circle distance (see
// centricLocationRing/haversineKm in app.js) -- a deliberate switch away
// from the old text heuristic ("same city"/"same region"/"same country"/
// "same hemisphere"), deferred until enough records had real coordinates
// to make the distance math worthwhile (see git history / BACKLOG.md).
// Each fixture below sits at a real-world distance from the center person
// clearly inside its intended band, with margin from the 50/200/1000/5000 km
// edges so this isn't sensitive to haversine's small approximation error.
function person(id, name, year, loc) {
  return {
    id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    locations: loc ? [loc] : [],
  };
}
const people = {};
const add = (p) => { people[p.id] = p; };
// Center: Boston, Massachusetts.
add(person('center', 'Alice Center', 1970, { text: 'Boston, Massachusetts', lat: 42.3601, lon: -71.0589 }));
// ~7 km away -- well inside the <50 km band.
add(person('band1', 'Cam Nearby', 1975, { text: 'Cambridge, Massachusetts', lat: 42.3736, lon: -71.1097 }));
// ~69 km away -- inside the 50-200 km band.
add(person('band2', 'Prov Regional', 1978, { text: 'Providence, Rhode Island', lat: 41.8240, lon: -71.4128 }));
// ~306 km away -- inside the 200-1,000 km band.
add(person('band3', 'Nyc Distant', 1980, { text: 'New York, New York', lat: 40.7128, lon: -74.0060 }));
// ~1,720 km away -- inside the 1,000-5,000 km band.
add(person('band4', 'Chi Faraway', 1982, { text: 'Chicago, Illinois', lat: 41.8781, lon: -87.6298 }));
// ~16,000 km away -- inside the 5,000+ km band.
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

  console.log('=== Ring labels: 5 real-distance bands ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  console.log('labels:', JSON.stringify(labels));
  for (const expected of ['< 50 km', '50–200 km', '200–1,000 km', '1,000–5,000 km', '5,000+ km / unknown']) {
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

  console.log('\n=== Ring order: <50km < 50-200km < 200-1,000km < 1,000-5,000km < 5,000+km/unknown ===');
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
