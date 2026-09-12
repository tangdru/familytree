import { chromium } from 'playwright-core';

const legacy = 'legacy';
const people = {
  [legacy]: { id: legacy, name: 'Legacy Person', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', location: 'Old City, Oldland', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 950 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Legacy person (old singular `location` field): view card should show it as current (meta row), no Previous location(s) section (nothing to show yet) ===');
  await page.click('.person-card:has-text("Legacy Person")');
  await page.waitForTimeout(200);
  let viewState = await page.evaluate(() => ({
    meta: document.getElementById('viewMeta').textContent,
    sectionHidden: document.getElementById('viewLocationsSection').hidden,
  }));
  console.log(JSON.stringify(viewState));
  if (!viewState.meta.includes('Old City, Oldland')) throw new Error('Expected legacy location to show as current in the meta row');
  if (!viewState.sectionHidden) {
    throw new Error('Expected the Previous location(s) section to stay hidden when there is only a current location');
  }

  console.log('\n=== Edit legacy person: the old value should preload into the Location(s) list ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  let rowValues = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row-input')).map(el => el.textContent));
  console.log('preloaded rows:', JSON.stringify(rowValues));
  if (rowValues.length !== 1 || rowValues[0] !== 'Old City, Oldland') throw new Error('Expected the legacy location preloaded as the single row');

  console.log('\n=== Add a second (older) location + a birth location, save ===');
  await page.click('#addLocationBtn');
  await page.waitForTimeout(100);
  const inputs = await page.$$('.location-row-input');
  console.log('row count after +Add:', inputs.length);
  if (inputs.length !== 2) throw new Error('Expected a second empty row after clicking +Add location');
  await inputs[1].click();
  await page.keyboard.type('Birth City, Birthland');

  await page.click('#birthLocationInput');
  await page.keyboard.type('Home Town, Homeland');

  // Tags: first row should read "Current", second should have no tag text.
  let tags = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row')).map(r => ({
    hidden: r.querySelector('.location-current-tag').hidden,
  })));
  console.log('current-tag visibility per row:', JSON.stringify(tags));
  if (tags[0].hidden || !tags[1].hidden) throw new Error('Expected only the first row to show the Current tag');

  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.legacy);
  console.log('saved person:', JSON.stringify({ locations: saved.locations, location: saved.location, birthLocation: saved.birthLocation }));
  if (!saved.locations || saved.locations.length !== 2 || saved.locations[0].text !== 'Old City, Oldland' || saved.locations[1].text !== 'Birth City, Birthland') {
    throw new Error('Expected two saved locations in order');
  }
  if (saved.location !== undefined) throw new Error('Expected the stale singular `location` field to be removed after save');
  if (saved.birthLocation !== 'Home Town, Homeland') throw new Error('Expected birthLocation to be saved');

  console.log('\n=== Saving returns to the view card: current in the meta row, Previous location(s) lists only the rest, birth location line in the grouped details block ===');
  viewState = await page.evaluate(() => ({
    meta: document.getElementById('viewMeta').textContent,
    details: Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent),
    sectionHidden: document.getElementById('viewLocationsSection').hidden,
    historyRows: Array.from(document.querySelectorAll('#viewLocationsList li')).map(li => li.querySelector('.view-location-text').textContent),
  }));
  console.log(JSON.stringify(viewState));
  if (!viewState.meta.includes('Old City, Oldland')) throw new Error('Expected the first (current) location in the meta row');
  if (!viewState.details.includes('Born in Home Town, Homeland')) throw new Error('Expected the birth location line in the grouped details block, got: ' + JSON.stringify(viewState.details));
  if (viewState.sectionHidden || viewState.historyRows.length !== 1 || viewState.historyRows[0] !== 'Birth City, Birthland') {
    throw new Error('Expected only the non-current location in Previous location(s), got: ' + JSON.stringify(viewState.historyRows));
  }

  console.log('\n=== Remove a location row in the edit form ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('.location-row-remove >> nth=1');
  await page.waitForTimeout(100);
  rowValues = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row-input')).map(el => el.textContent));
  console.log('rows after removing second:', JSON.stringify(rowValues));
  if (rowValues.length !== 1 || rowValues[0] !== 'Old City, Oldland') throw new Error('Expected only the first row to remain');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const savedAfterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.legacy);
  console.log('locations after removal save:', JSON.stringify(savedAfterRemove.locations));
  if (savedAfterRemove.locations.length !== 1) throw new Error('Expected only one saved location after removal');

  console.log('\n=== Add Person flow: fresh modal should start with exactly one empty location row ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  const freshRows = await page.$$('.location-row-input');
  console.log('fresh add-person row count:', freshRows.length);
  if (freshRows.length !== 1) throw new Error('Expected exactly one empty location row on Add Person');
  await page.click('#cancelBtn');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
