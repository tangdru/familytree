import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  console.log('=== No zodiac set: view card should not show a zodiac line ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  let hidden = await page.getAttribute('#viewZodiac', 'hidden');
  console.log('viewZodiac hidden (expect non-null):', hidden);
  if (hidden === null) throw new Error('Expected no zodiac line when unset');

  console.log('\n=== Set zodiac to Dragon in the edit form, save ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const options = await page.$$eval('#zodiacInput option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));
  console.log('dropdown options:', JSON.stringify(options));
  if (options.length !== 13) throw new Error('Expected 12 zodiac animals plus the blank option');
  await page.selectOption('#zodiacInput', 'Dragon');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved zodiac:', saved.zodiac);
  if (saved.zodiac !== 'Dragon') throw new Error('Expected zodiac to be saved as Dragon');

  console.log('\n=== Saving now returns straight to the Person View: should show the Dragon emoji + name ===');
  const zodiacText = await page.textContent('#viewZodiac');
  console.log('view card zodiac line:', zodiacText);
  if (zodiacText !== '🐉 Dragon') throw new Error('Expected the view card to show "🐉 Dragon"');

  console.log('\n=== Reopen edit form: dropdown should preselect Dragon ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const selected = await page.$eval('#zodiacInput', el => el.value);
  console.log('selected value:', selected);
  if (selected !== 'Dragon') throw new Error('Expected the dropdown to preselect Dragon');

  console.log('\n=== Clear it back to blank, save, confirm it disappears from the card ===');
  await page.selectOption('#zodiacInput', '');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  hidden = await page.getAttribute('#viewZodiac', 'hidden');
  console.log('viewZodiac hidden after clearing (expect non-null):', hidden);
  if (hidden === null) throw new Error('Expected the zodiac line to disappear after clearing');
  const savedCleared = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1.zodiac);
  console.log('saved zodiac after clearing:', JSON.stringify(savedCleared));
  if (savedCleared !== '') throw new Error('Expected saved zodiac to be an empty string after clearing');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
