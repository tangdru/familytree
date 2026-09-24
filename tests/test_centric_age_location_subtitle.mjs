import { chromium } from 'playwright-core';

function person(id, name, year, loc) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: loc ? [loc] : [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
// Location metric now groups by real great-circle distance (see
// centricLocationRing/haversineKm in app.js), a 5x geometric progression
// (5/25/100/500 km) -- not the old "same city/country/hemisphere" text
// heuristic -- each fixture below sits at a real-world distance from the
// center clearly inside its intended band.
// Center: born 1970, Boston, Massachusetts.
add(person('center', 'Alice Center', 1970, { text: 'Boston, USA', lat: 42.3601, lon: -71.0589 }));
// ~7 km away -- inside the 5-25 km band.
add(person('sameCity', 'Sam City', 1975, { text: 'Cambridge, USA', lat: 42.3736, lon: -71.1097 }));
// ~69 km away -- inside the 25-100 km band.
add(person('sameCountry', 'Cody Country', 1980, { text: 'Providence, USA', lat: 41.8240, lon: -71.4128 }));
// ~306 km away -- inside the 100-500 km band.
add(person('sameHemi', 'Hemi North', 1982, { text: 'New York, USA', lat: 40.7128, lon: -74.0060 }));
// ~16,000 km away -- inside the 500+ km band.
add(person('otherHemi', 'Sydney South', 1985, { text: 'Sydney, Australia', lat: -33.8688, lon: 151.2093 }));
// No location at all.
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
  if (locSubtitle !== 'Cambridge, USA') throw new Error(`Expected location text, got: "${locSubtitle}"`);
  console.log('Confirmed: subtitle =', JSON.stringify(locSubtitle));

  const noLocSubtitle = await page.evaluate(() => {
    const el = document.querySelector('[data-id="noLoc"] .person-dates');
    return el ? el.textContent : null;
  });
  if (noLocSubtitle !== '') throw new Error(`Expected blank subtitle for no location, got: "${noLocSubtitle}"`);
  console.log('Confirmed: person with no location shows blank subtitle (not a stale birth year).');

  console.log('\n=== Location rings: real distance bands, near to far ===');
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

  if (!(dSameCity < dSameCountry && dSameCountry < dSameHemi && dSameHemi < dOtherHemi)) {
    throw new Error(`Expected strictly increasing radii near < mid < far < farthest, got: ${JSON.stringify({ dSameCity, dSameCountry, dSameHemi, dOtherHemi })}`);
  }
  // Sydney (~16,000 km, the 5,000+ km band) and noLoc (unlocatable) should
  // land in the SAME outermost ring as each other.
  if (Math.abs(dOtherHemi - dNoLoc) > 2) {
    throw new Error(`Expected the farthest real distance and noLoc in the same outermost ring, got distances ${dOtherHemi} vs ${dNoLoc}`);
  }
  console.log('Confirmed: 5-25km < 25-100km < 100-500km < 500+km, and the farthest real distance lands with no-location in the outermost ring.');

  console.log('\n=== Ring axis labels reflect the real-distance-band scheme ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  for (const expected of ['5–25 km (3–16 mi)', '25–100 km (16–62 mi)', '100–500 km (62–311 mi)', '500+ km (311+ mi) / unknown']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got labels: ${JSON.stringify(labels)}`);
  }
  console.log('Confirmed: ring labels =', JSON.stringify(labels));

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
