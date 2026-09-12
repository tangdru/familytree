import { chromium } from 'playwright-core';

// Confirms coordinates picked from the location autocomplete survive a
// later resave that doesn't touch the location field at all -- the edit
// form must preload from the RAW {text,lat,lon} entry (see
// locationEntriesOf), not from locationsOf's plain-text display form,
// or a routine edit (e.g. just fixing a typo in Notes) would silently
// wipe out previously-captured coordinates.
const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', locations: [], parents: [], spouses: [] },
};

const nominatimResponse = [
  {
    display_name: 'Boston, Suffolk County, Massachusetts, United States',
    address: { city: 'Boston', county: 'Suffolk County', state: 'Massachusetts', country: 'United States', country_code: 'us' },
    lat: '42.3600825',
    lon: '-71.0588801',
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

  console.log('=== Pick a location suggestion and save ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const row1Input = await page.$('.location-row-input');
  await row1Input.click();
  await page.keyboard.type('Bos');
  await page.waitForTimeout(600);
  await page.click('.location-row .combo-option:has-text("Boston")');
  await page.waitForTimeout(100);
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved after pick:', JSON.stringify(saved.locations));
  if (saved.locations[0].text !== 'Boston, Massachusetts') throw new Error(`Expected the picked text, got: ${JSON.stringify(saved.locations)}`);
  if (!Number.isFinite(saved.locations[0].lat) || !Number.isFinite(saved.locations[0].lon)) {
    throw new Error(`Expected real coordinates after picking a suggestion, got: ${JSON.stringify(saved.locations)}`);
  }
  const pickedLat = saved.locations[0].lat;
  const pickedLon = saved.locations[0].lon;

  console.log('\n=== Re-edit WITHOUT touching the location field, save again -- coordinates must survive ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const preloaded = await page.evaluate(() => document.querySelector('.location-row-input').textContent);
  console.log('preloaded location text:', preloaded);
  if (preloaded !== 'Boston, Massachusetts') throw new Error(`Expected the location to preload as its picked text, got: "${preloaded}"`);
  await page.fill('#notesInput', 'Just adding a note, not touching location');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved after unrelated resave:', JSON.stringify(saved.locations));
  if (saved.locations[0].lat !== pickedLat || saved.locations[0].lon !== pickedLon) {
    throw new Error(`Expected coordinates to survive an unrelated resave, got: ${JSON.stringify(saved.locations)} (expected lat=${pickedLat} lon=${pickedLon})`);
  }
  console.log('Confirmed: coordinates survive a resave that never touches the location field.');

  console.log('\n=== Hand-editing the location text after a pick invalidates its coordinates ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const input = await page.$('.location-row-input');
  await input.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Metro');
  await page.waitForTimeout(50);
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved after hand-edit:', JSON.stringify(saved.locations));
  if (saved.locations[0].lat !== null || saved.locations[0].lon !== null) {
    throw new Error(`Expected hand-editing the text to invalidate its stale coordinates, got: ${JSON.stringify(saved.locations)}`);
  }

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
