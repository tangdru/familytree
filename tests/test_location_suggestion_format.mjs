import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', locations: [], parents: [], spouses: [] },
};

// A trimmed but realistic Nominatim addressdetails=1 response -- one US
// result (should shorten to "City, State") and one non-US result (should
// shorten to "City, Country"), plus a second US result sharing the same
// city+state as the first (different zip) to exercise the dedupe.
const nominatimResponse = [
  {
    display_name: 'Melrose, Middlesex County, Massachusetts, 02176, United States',
    address: { city: 'Melrose', county: 'Middlesex County', state: 'Massachusetts', postcode: '02176', country: 'United States', country_code: 'us' },
  },
  {
    display_name: 'Melrose, Middlesex County, Massachusetts, 02177, United States',
    address: { city: 'Melrose', county: 'Middlesex County', state: 'Massachusetts', postcode: '02177', country: 'United States', country_code: 'us' },
  },
  {
    display_name: 'Paris, Île-de-France, Metropolitan France, France',
    address: { city: 'Paris', state: 'Île-de-France', country: 'France', country_code: 'fr' },
  },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.route('**://nominatim.openstreetmap.org/search**', (route) => {
    const url = new URL(route.request().url());
    console.log('Nominatim request addressdetails=', url.searchParams.get('addressdetails'));
    if (url.searchParams.get('addressdetails') !== '1') throw new Error('Expected addressdetails=1 in the request');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nominatimResponse) });
  });
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  console.log('=== Type into the first Location(s) row and check the suggestion labels ===');
  const row1Input = await page.$('.location-row-input');
  await row1Input.click();
  await page.keyboard.type('Mel');
  await page.waitForTimeout(600); // debounce + fulfilled route

  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.location-row .combo-option')).map(el => el.textContent));
  console.log('suggestion labels:', JSON.stringify(labels));
  if (labels.length !== 2) throw new Error('Expected the two duplicate Melrose results to collapse into one, alongside Paris');
  if (labels[0] !== 'Melrose, Massachusetts') throw new Error('Expected the US result shortened to "City, State"');
  if (labels[1] !== 'Paris, France') throw new Error('Expected the non-US result shortened to "City, Country"');

  console.log('\n=== Clicking a suggestion fills the short label, not the raw display_name ===');
  await page.click('.location-row .combo-option:has-text("Melrose")');
  await page.waitForTimeout(100);
  const filled = await page.evaluate(() => document.querySelector('.location-row-input').textContent);
  console.log('input value after click:', filled);
  if (filled !== 'Melrose, Massachusetts') throw new Error('Expected the field to be filled with the short label');

  console.log('\n=== Same formatting applies to the Birth location field ===');
  await page.click('#birthLocationInput');
  await page.keyboard.type('Mel');
  await page.waitForTimeout(600);
  const birthLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#birthLocationSuggestions .combo-option')).map(el => el.textContent));
  console.log('birth location suggestion labels:', JSON.stringify(birthLabels));
  if (birthLabels[0] !== 'Melrose, Massachusetts') throw new Error('Expected birth location suggestions to use the same short format');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
