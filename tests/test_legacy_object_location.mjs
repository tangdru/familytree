import { chromium } from 'playwright-core';

// Simulates a record saved while the real-distance Centric feature (PR
// #105/#106) was briefly live: a location entry saved as a {text, lat,
// lon} object instead of a plain string. After reverting that feature,
// this shape must not crash rendering -- see locationsOf's defensive
// unwrap.
const p1 = 'p1';
const people = {
  [p1]: {
    id: p1, name: 'Leftover Object', birthDate: '1980-01-01', deathDate: '', photo: '', notes: '',
    parents: [], spouses: [],
    locations: [
      { text: 'Boston, Massachusetts', lat: 42.3601, lon: -71.0589 },
      'Chicago, Illinois',
    ],
  },
  p2: { id: 'p2', name: 'Plain Person', birthDate: '1985-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: ['Chicago, Illinois'] },
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

  console.log('=== Person View: a leftover {text,lat,lon} location object must not crash rendering ===');
  await page.click('.person-card:has-text("Leftover Object")');
  await page.waitForTimeout(300);
  const meta = await page.evaluate(() => document.getElementById('viewMeta').textContent);
  console.log('meta row:', meta);
  if (!meta.includes('Boston, Massachusetts')) throw new Error(`Expected the object location's text to show as current, got: "${meta}"`);
  const historyRows = await page.evaluate(() => Array.from(document.querySelectorAll('#viewLocationsList .view-location-text')).map(el => el.textContent));
  console.log('previous locations:', JSON.stringify(historyRows));
  if (historyRows.length !== 1 || historyRows[0] !== 'Chicago, Illinois') throw new Error(`Expected the plain-string second location, got: ${JSON.stringify(historyRows)}`);
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Centric view: the OBJECT-shaped center person must not crash rendering or leave stale Age labels ===');
  // 'Leftover Object' (p1) is still centered here (default center = first
  // person by insertion order) with its location STILL in the object
  // shape -- this exercises the exact bug: centerLoc = currentLocationOf
  // (center) runs very early in renderCentric, before the axis labels are
  // (re)drawn, so a throw there bails out before ever reaching that code,
  // leaving whatever labels the PREVIOUS metric (Age) drew stuck on
  // screen even though the Location button is now active.
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const cardCount = await page.evaluate(() => document.querySelectorAll('.person-card').length);
  console.log('centric card count:', cardCount);
  if (cardCount < 2) throw new Error(`Expected both people rendered as cards in Centric view, got ${cardCount}`);
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#centricLabelsSvg text')).map(t => t.textContent));
  console.log('axis labels:', JSON.stringify(labels));
  if (labels.some(l => /yrs/.test(l))) throw new Error(`Expected Location-metric labels, but found stale Age labels: ${JSON.stringify(labels)}`);
  if (!labels.some(l => /Same city|Elsewhere/.test(l))) throw new Error(`Expected Location-metric labels (e.g. "Same city"), got: ${JSON.stringify(labels)}`);
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(300);

  console.log('\n=== Edit form: the object location preloads as its text (via locationEntriesOf), coordinates preserved on resave ===');
  await page.click('.person-card:has-text("Leftover Object")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const rowValues = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row-input')).map(el => el.textContent));
  console.log('preloaded rows:', JSON.stringify(rowValues));
  if (rowValues[0] !== 'Boston, Massachusetts') throw new Error(`Expected the object location to preload as its text, got: ${JSON.stringify(rowValues)}`);
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved locations after resave:', JSON.stringify(saved.locations));
  // The coordinate-capture plumbing preloads the edit form from the RAW
  // entry (see locationEntriesOf), not locationsOf's flattened display
  // text -- so a location that already had real coordinates keeps them
  // across a resave, rather than losing them the moment it's re-edited.
  if (saved.locations[0].text !== 'Boston, Massachusetts' || saved.locations[0].lat !== 42.3601 || saved.locations[0].lon !== -71.0589) {
    throw new Error(`Expected the resave to preserve the existing coordinates, got: ${JSON.stringify(saved.locations)}`);
  }
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
