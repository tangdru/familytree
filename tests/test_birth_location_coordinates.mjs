import { chromium } from 'playwright-core';

// Birth location is now a real point on the same migration timeline as
// the repeatable Location(s) list (its date is always birthDate, non-
// editable) -- so picking a suggestion for it must capture coordinates
// too, mirroring the Location(s) rows' own onPick treatment, while
// staying its own separate field in the UI (see birthLocationTextOf).
const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', locations: [], parents: [], spouses: [] },
};

const nominatimResponse = [
  {
    display_name: 'Chicago, Cook County, Illinois, United States',
    address: { city: 'Chicago', county: 'Cook County', state: 'Illinois', country: 'United States', country_code: 'us' },
    lat: '41.8781136',
    lon: '-87.6297982',
  },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.route('**://nominatim.openstreetmap.org/search**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nominatimResponse) });
  });
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Pick a birth-location suggestion and save ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#birthLocationInput');
  await page.keyboard.type('Chi');
  await page.waitForTimeout(600);
  await page.click('#birthLocationSuggestions .combo-option:has-text("Chicago")');
  await page.waitForTimeout(100);
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved birthLocation:', JSON.stringify(saved.birthLocation));
  if (typeof saved.birthLocation !== 'object' || saved.birthLocation.text !== 'Chicago, Illinois') {
    throw new Error(`Expected the picked text as an object, got: ${JSON.stringify(saved.birthLocation)}`);
  }
  if (!Number.isFinite(saved.birthLocation.lat) || !Number.isFinite(saved.birthLocation.lon)) {
    throw new Error(`Expected real coordinates after picking a suggestion, got: ${JSON.stringify(saved.birthLocation)}`);
  }
  const pickedLat = saved.birthLocation.lat;

  console.log('\n=== Person View still shows "Born in Chicago, Illinois" (birthLocationTextOf unwraps the object) ===');
  const details = await page.evaluate(() => Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent));
  console.log('details:', JSON.stringify(details));
  if (!details.some(d => d === 'Born in Chicago, Illinois')) throw new Error(`Expected a "Born in Chicago, Illinois" line, got: ${JSON.stringify(details)}`);

  console.log('\n=== Re-edit WITHOUT touching birth location, save again -- coordinates survive ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const preloaded = await page.evaluate(() => document.getElementById('birthLocationInput').textContent);
  if (preloaded !== 'Chicago, Illinois') throw new Error(`Expected birth location to preload as its picked text, got: "${preloaded}"`);
  await page.fill('#notesInput', 'Unrelated edit');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved birthLocation after unrelated resave:', JSON.stringify(saved.birthLocation));
  if (saved.birthLocation.lat !== pickedLat) throw new Error(`Expected birth-location coordinates to survive an unrelated resave, got: ${JSON.stringify(saved.birthLocation)}`);
  console.log('Confirmed: birth-location coordinates survive a resave that never touches that field.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
