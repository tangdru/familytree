import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
// Center: Boston, Massachusetts (US, "City, State" format so the region
// tier -- the US state -- is distinct from the country tier).
add(person('center', 'Alice Center', 1970, 'Boston, Massachusetts'));
add(person('sameCity', 'Sam City', 1975, 'Boston, Massachusetts'));
// Same state (region), different city.
add(person('sameRegion', 'Remy Region', 1978, 'Worcester, Massachusetts'));
// Same country (US), different state -- region tier misses, country tier catches it.
add(person('sameCountry', 'Cody Country', 1980, 'Chicago, Illinois'));
// Same hemisphere (Northern), different country.
add(person('sameHemi', 'Hemi North', 1982, 'Paris, France'));
// Different hemisphere entirely.
add(person('otherHemi', 'Sydney South', 1985, 'Sydney, Australia'));
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
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);

  console.log('=== Ring labels: 5 tiers, region restored ===');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#linesSvg text')).map(t => t.textContent));
  console.log('labels:', JSON.stringify(labels));
  for (const expected of ['Same city', 'Same region', 'Same country', 'Same hemisphere', 'Elsewhere']) {
    if (!labels.includes(expected)) throw new Error(`Expected a "${expected}" ring label, got: ${JSON.stringify(labels)}`);
  }
  if (labels.length !== 5) throw new Error(`Expected exactly 5 ring labels, got ${labels.length}`);
  console.log('Confirmed: all 5 location ring labels present.');

  const ringOf = async (id) => page.evaluate((id) => {
    const center = document.querySelector('.centric-center-card').getBoundingClientRect();
    const el = document.querySelector(`[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - (center.left + center.width / 2);
    const dy = (r.top + r.height / 2) - (center.top + center.height / 2);
    return Math.hypot(dx, dy);
  }, id);

  console.log('\n=== Ring order: city < region < country < hemisphere < elsewhere ===');
  const d = {};
  for (const id of ['sameCity', 'sameRegion', 'sameCountry', 'sameHemi', 'otherHemi', 'noLoc']) {
    d[id] = await ringOf(id);
  }
  console.log('distances:', JSON.stringify(d));
  if (!(d.sameCity < d.sameRegion && d.sameRegion < d.sameCountry && d.sameCountry < d.sameHemi && d.sameHemi < d.otherHemi)) {
    throw new Error(`Expected strictly increasing radii city < region < country < hemisphere < elsewhere, got ${JSON.stringify(d)}`);
  }
  if (Math.abs(d.otherHemi - d.noLoc) > 2) {
    throw new Error(`Expected otherHemi and noLoc in the same outermost ring, got ${d.otherHemi} vs ${d.noLoc}`);
  }
  console.log('Confirmed: 5-tier ordering correct, cross-hemisphere and no-location share the outermost ring.');

  console.log('\n=== Switching Age <-> Location now genuinely adds/removes the 5th ring ===');
  await page.click('.centric-metric-btn[data-metric="age"]');
  await page.waitForTimeout(700);
  const ageRingCount = (await page.evaluate(() => document.querySelectorAll('#linesSvg circle[stroke-dasharray]').length));
  if (ageRingCount !== 4) throw new Error(`Expected 4 rings in Age metric, got ${ageRingCount}`);
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const locRingCount = (await page.evaluate(() => document.querySelectorAll('#linesSvg circle[stroke-dasharray]').length));
  if (locRingCount !== 5) throw new Error(`Expected 5 rings in Location metric, got ${locRingCount}`);
  console.log('Confirmed: Age has 4 rings, Location has 5.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
