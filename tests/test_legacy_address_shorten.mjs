import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: {
    id: p1, name: 'Andrew Tang', birthDate: '1978-11-23', deathDate: '', photo: '', notes: '',
    birthLocation: 'Melrose, Middlesex County, Massachusetts, 02176, United States',
    locations: [
      'Melrose, Middlesex County, Massachusetts, 02176, United States',
      'Bellingham, Whatcom County, Washington, United States',
      'Paris, Île-de-France, Metropolitan France, France',
      'Boston, Massachusetts', // already-short 2-segment value: must be left untouched
    ],
    parents: [], spouses: [],
  },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== View card: meta row, birth location, and history should all show shortened text ===');
  await page.click('.person-card:has-text("Andrew Tang")');
  await page.waitForTimeout(200);
  let viewState = await page.evaluate(() => ({
    meta: document.getElementById('viewMeta').textContent,
    details: Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent),
    history: Array.from(document.querySelectorAll('#viewLocationsList .view-location-text')).map(el => el.textContent),
  }));
  console.log(JSON.stringify(viewState, null, 2));
  if (!viewState.meta.includes('Melrose, Massachusetts')) throw new Error('Expected the meta row\'s current location to be shortened');
  if (!viewState.details.includes('Born in Melrose, Massachusetts')) throw new Error('Expected the birth location line to be shortened, got: ' + JSON.stringify(viewState.details));
  const expectedHistory = ['Melrose, Massachusetts', 'Bellingham, Washington', 'Paris, France', 'Boston, Massachusetts'];
  const expectedPrevious = expectedHistory.slice(1); // the current (index 0) already shows under the photo
  if (JSON.stringify(viewState.history) !== JSON.stringify(expectedPrevious)) {
    throw new Error('Expected Previous location(s) to be the shortened non-current entries: ' + JSON.stringify(viewState.history));
  }

  console.log('\n=== Edit form: rows should preload already shortened, with no resave needed first ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const rowValues = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row-input')).map(el => el.textContent));
  const birthValue = await page.evaluate(() => document.getElementById('birthLocationInput').textContent);
  console.log('row values:', JSON.stringify(rowValues));
  console.log('birth location value:', birthValue);
  if (JSON.stringify(rowValues) !== JSON.stringify(expectedHistory)) throw new Error('Expected edit-form rows to preload shortened');
  if (birthValue !== 'Melrose, Massachusetts') throw new Error('Expected birth location field to preload shortened');

  console.log('\n=== Saving now (self-heal): the raw stored data should update to the short form ===');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved locations:', JSON.stringify(saved.locations));
  console.log('saved birthLocation:', saved.birthLocation);
  const savedTexts = saved.locations.map(loc => loc.text);
  if (JSON.stringify(savedTexts) !== JSON.stringify(expectedHistory)) throw new Error('Expected the saved data to now be the shortened form, got: ' + JSON.stringify(savedTexts));
  if (saved.birthLocation.text !== 'Melrose, Massachusetts') throw new Error('Expected saved birthLocation to be shortened, got: ' + JSON.stringify(saved.birthLocation));

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
