import { chromium } from 'playwright-core';

// Real coordinates, so the Location metric's ring bucketing exercises the
// actual haversine distance calculation (see haversineDistanceKm/
// centricLocationRing in app.js). Distances from Boston:
//   Boston -> Cambridge   ~3 mi     (ring 1: 0-50 mi)
//   Boston -> New York    ~190 mi   (ring 2: 50-500 mi)
//   Boston -> Los Angeles ~2,600 mi (ring 3: 500-3,000 mi)
//   Boston -> Sydney      ~9,950 mi (ring 4: 3,000+ mi)
function person(id, name, year, text, lat, lon) {
  const locations = text ? [{ text, lat: lat ?? null, lon: lon ?? null }] : [];
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations };
}
const people = {};
const add = (p) => { people[p.id] = p; };
// Center: born 1970, Boston.
add(person('center', 'Alice Center', 1970, 'Boston, Massachusetts', 42.3601, -71.0589));
add(person('sameCity', 'Sam City', 1975, 'Cambridge, Massachusetts', 42.3736, -71.1097));
add(person('sameCountry', 'Cody Country', 1980, 'New York, New York', 40.7128, -74.0060));
add(person('sameHemi', 'Hemi North', 1982, 'Los Angeles, California', 34.0522, -118.2437));
add(person('otherHemi', 'Sydney South', 1985, 'Sydney, Australia', -33.8688, 151.2093));
// No location at all.
add(person('noLoc', 'No Location', 1990, ''));

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
  // 'center' is added first, so it's the deterministic default center
  // (see renderCentric's fallback) -- no need to click to recenter.
  const centerId = await page.evaluate(() => document.querySelector('.centric-center-card').dataset.id);
  if (centerId !== 'center') throw new Error(`Expected 'center' to be the default centric center, got '${centerId}'`);

  console.log('=== Age metric: subtitle shows Age N, not birth year ===');
  const ageSubtitle = await page.evaluate(() => {
    const el = document.querySelector('[data-id="sameCity"] .person-dates');
    return el ? el.textContent : null;
  });
  if (!/^Age \d+$/.test(ageSubtitle || '')) {
    throw new Error(`Expected an "Age N" subtitle under Age metric, got: "${ageSubtitle}"`);
  }
  console.log('Confirmed: subtitle =', JSON.stringify(ageSubtitle));

  const centerAgeSubtitle = await page.evaluate(() => {
    const el = document.querySelector('.centric-center-card .person-dates');
    return el ? el.textContent : null;
  });
  if (!/^Age \d+$/.test(centerAgeSubtitle || '')) {
    throw new Error(`Expected the CENTER card to also show Age N, got: "${centerAgeSubtitle}"`);
  }
  console.log('Confirmed: center card subtitle =', JSON.stringify(centerAgeSubtitle));

  console.log('\n=== Switch to Location metric: subtitle shows location text ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const locSubtitle = await page.evaluate(() => {
    const el = document.querySelector('[data-id="sameCity"] .person-dates');
    return el ? el.textContent : null;
  });
  if (locSubtitle !== 'Cambridge, Massachusetts') throw new Error(`Expected location text, got: "${locSubtitle}"`);
  console.log('Confirmed: subtitle =', JSON.stringify(locSubtitle));

  const noLocSubtitle = await page.evaluate(() => {
    const el = document.querySelector('[data-id="noLoc"] .person-dates');
    return el ? el.textContent : null;
  });
  if (noLocSubtitle !== '') throw new Error(`Expected blank subtitle for no location, got: "${noLocSubtitle}"`);
  console.log('Confirmed: person with no location shows blank subtitle (not a stale birth year).');

  console.log('\n=== Location rings: real distance from 0-50mi up to 3000+mi, unknown last ===');
  const ringOf = async (id) => page.evaluate((id) => {
    // Reverse-engineer which ring a card landed in from its radial distance
    // to the center card, since ring membership isn't exposed as a DOM attr.
    const center = document.querySelector('.centric-center-card').getBoundingClientRect();
    const el = document.querySelector(`[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - (center.left + center.width / 2);
    const dy = (r.top + r.height / 2) - (center.top + center.height / 2);
    return Math.hypot(dx, dy);
  }, id);

  const dSameCity = await ringOf('sameCity');
  const dSameCountry = await ringOf('sameCountry');
  const dSameHemi = await ringOf('sameHemi');
  const dOtherHemi = await ringOf('otherHemi');
  const dNoLoc = await ringOf('noLoc');

  // noLoc has no location at all, so it can never get real coordinates --
  // it always lands in the outermost "Unknown distance" ring (5), one ring
  // farther out than even the 3,000+ mi tier (4) that otherHemi (Sydney)
  // lands in, so the full chain is strictly increasing.
  if (!(dSameCity < dSameCountry && dSameCountry < dSameHemi && dSameHemi < dOtherHemi && dOtherHemi < dNoLoc)) {
    throw new Error(`Expected strictly increasing radii 0-50mi < 50-500mi < 500-3000mi < 3000+mi < unknown, got: ${JSON.stringify({ dSameCity, dSameCountry, dSameHemi, dOtherHemi, dNoLoc })}`);
  }
  console.log('Confirmed: 0-50mi < 50-500mi < 500-3000mi < 3000+mi < unknown distance (no location at all is farthest of all).');

  console.log('\n=== Ring axis labels reflect the real-distance mi/km scheme ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  for (const expected of ['0–50 mi (0–80 km)', '50–500 mi (80–800 km)', '500–3,000 mi (800–4,800 km)', '3,000+ mi (4,800+ km)', 'Unknown distance']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got labels: ${JSON.stringify(labels)}`);
  }
  console.log('Confirmed: ring labels =', JSON.stringify(labels));

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
