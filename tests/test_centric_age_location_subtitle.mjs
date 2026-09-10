import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
// Center: born 1970, Boston USA.
add(person('center', 'Alice Center', 1970, 'Boston, USA'));
// Same city as center.
add(person('sameCity', 'Sam City', 1975, 'Boston, USA'));
// Same country (US), different city.
add(person('sameCountry', 'Cody Country', 1980, 'Chicago, USA'));
// Same hemisphere (Northern) but different country -- France.
add(person('sameHemi', 'Hemi North', 1982, 'Paris, France'));
// Southern hemisphere -- Australia (opposite hemisphere from Boston).
add(person('otherHemi', 'Sydney South', 1985, 'Sydney, Australia'));
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
  if (locSubtitle !== 'Boston, USA') throw new Error(`Expected location text, got: "${locSubtitle}"`);
  console.log('Confirmed: subtitle =', JSON.stringify(locSubtitle));

  const noLocSubtitle = await page.evaluate(() => {
    const el = document.querySelector('[data-id="noLoc"] .person-dates');
    return el ? el.textContent : null;
  });
  if (noLocSubtitle !== '') throw new Error(`Expected blank subtitle for no location, got: "${noLocSubtitle}"`);
  console.log('Confirmed: person with no location shows blank subtitle (not a stale birth year).');

  console.log('\n=== Location rings: city / country / hemisphere / elsewhere ===');
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
    throw new Error(`Expected strictly increasing radii city < country < hemisphere < elsewhere, got: ${JSON.stringify({ dSameCity, dSameCountry, dSameHemi, dOtherHemi })}`);
  }
  // otherHemi (Australia, Southern) and noLoc should land in the SAME
  // (outermost, "elsewhere") ring as each other.
  if (Math.abs(dOtherHemi - dNoLoc) > 2) {
    throw new Error(`Expected otherHemi and noLoc in the same outermost ring, got distances ${dOtherHemi} vs ${dNoLoc}`);
  }
  console.log('Confirmed: same-city < same-country < same-hemisphere < elsewhere, and cross-hemisphere lands with no-location in the outermost ring.');

  console.log('\n=== Ring axis labels reflect the new 4-tier location scheme ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#linesSvg text')).map(t => t.textContent));
  for (const expected of ['Same city', 'Same country', 'Same hemisphere', 'Elsewhere']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got labels: ${JSON.stringify(labels)}`);
  }
  console.log('Confirmed: ring labels =', JSON.stringify(labels));

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
