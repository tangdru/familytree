import { chromium } from 'playwright-core';

const p1 = 'p1';
// 2020 -> Rat, 1994 -> Dog, 1978 -> Horse (all per (year-4)%12).
const people = {
  [p1]: { id: p1, name: 'Existing Person', birthDate: '1978-11-23', deathDate: '', photo: '', notes: '', zodiac: 'Rooster', parents: [], spouses: [] },
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

  console.log('=== Add Person: entering a birth date auto-fills the zodiac dropdown ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  let zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac before birth date is set (expect blank):', JSON.stringify(zodiac));
  if (zodiac !== '') throw new Error('Expected zodiac to start blank');
  await page.fill('#birthInput', '2020-06-15');
  await page.dispatchEvent('#birthInput', 'change');
  await page.waitForTimeout(100);
  zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac after setting birth year 2020 (expect Rat):', zodiac);
  if (zodiac !== 'Rat') throw new Error('Expected 2020 to auto-infer as Rat');

  console.log('\n=== Changing birth date again keeps auto-updating until the user touches the dropdown ===');
  await page.fill('#birthInput', '1994-01-01');
  await page.dispatchEvent('#birthInput', 'change');
  await page.waitForTimeout(100);
  zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac after changing birth year to 1994 (expect Dog):', zodiac);
  if (zodiac !== 'Dog') throw new Error('Expected 1994 to auto-infer as Dog');

  console.log('\n=== Manually overriding the dropdown stops further auto-updates ===');
  await page.selectOption('#zodiacInput', 'Tiger');
  await page.fill('#birthInput', '2020-06-15');
  await page.dispatchEvent('#birthInput', 'change');
  await page.waitForTimeout(100);
  zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac after manual override + another birth date change (expect it to stay Tiger):', zodiac);
  if (zodiac !== 'Tiger') throw new Error('Expected the manual override to stick despite the birth date changing again');

  await page.click('#cancelBtn');
  await page.waitForTimeout(150);

  console.log('\n=== Editing an existing person: opening the form does NOT clobber their saved zodiac ===');
  await page.click('.person-card:has-text("Existing Person")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac on opening edit for a 1978-born person with saved zodiac Rooster (expect Rooster, not auto Horse):', zodiac);
  if (zodiac !== 'Rooster') throw new Error('Expected the existing saved zodiac to be preserved on open, not silently replaced by inference');

  console.log('\n=== But changing the birth date on an existing record still re-infers (since dropdown untouched this session) ===');
  await page.fill('#birthInput', '2020-06-15');
  await page.dispatchEvent('#birthInput', 'change');
  await page.waitForTimeout(100);
  zodiac = await page.$eval('#zodiacInput', el => el.value);
  console.log('zodiac after changing birth date on existing record (expect Rat):', zodiac);
  if (zodiac !== 'Rat') throw new Error('Expected changing the birth date to re-infer the zodiac');
  await page.click('#cancelBtn');
  await page.waitForTimeout(150);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
