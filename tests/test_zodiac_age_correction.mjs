import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript(() => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: {} }));
  });
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Add a person: documented 1975-01-01, select Dog zodiac ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('nameInput').textContent = 'Test Person'; document.getElementById('nameInput').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#birthInput', '1975-01-01');
  await page.locator('#birthInput').dispatchEvent('change');
  await page.waitForTimeout(100);

  await page.selectOption('#zodiacInput', 'Dog');
  await page.waitForTimeout(100);

  const hintVisible = await page.evaluate(() => !document.getElementById('zodiacAdjustedHint').hidden);
  const hintText = await page.evaluate(() => document.getElementById('zodiacAdjustedHint').textContent);
  console.log('hint visible:', hintVisible, 'text:', hintText);
  if (!hintVisible) throw new Error('Expected the zodiac-adjusted hint to be visible after selecting Dog');
  if (!hintText.includes('1970')) throw new Error(`Expected the hint to mention 1970 (1975 birth + Dog sign -> 1970), got: ${hintText}`);
  console.log('Confirmed: form hint correctly computes 1970 for a 1975-entered Dog.');

  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);

  console.log('\n=== Tree card caption shows the ADJUSTED year, not the documented one ===');
  const cardDatesText = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.person-card')).find(c => c.querySelector('.person-name').textContent === 'Test Person');
    return card ? card.querySelector('.person-dates').textContent : null;
  });
  console.log('card dates text:', cardDatesText);
  if (!cardDatesText || !cardDatesText.includes('1970')) throw new Error(`Expected the tree card to show 1970 (adjusted), got: ${cardDatesText}`);
  console.log('Confirmed: tree card shows the zodiac-adjusted year.');

  console.log('\n=== Person View shows BOTH dates, clearly labeled ===');
  const cardBox = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.person-card')).find(c => c.querySelector('.person-name').textContent === 'Test Person');
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(cardBox.x + cardBox.w / 2, cardBox.y + cardBox.h / 2);
  await page.waitForTimeout(300);
  const viewDatesText = await page.evaluate(() => document.getElementById('viewDates').textContent);
  const viewDatesAdjustedText = await page.evaluate(() => document.getElementById('viewDatesAdjusted').textContent);
  console.log('viewDates:', JSON.stringify(viewDatesText));
  console.log('viewDatesAdjusted:', JSON.stringify(viewDatesAdjustedText));
  if (!viewDatesText.startsWith('Doc.:') || !viewDatesText.includes('1975')) {
    throw new Error(`Expected viewDates to show "Doc.: ... 1975 ...", got: ${viewDatesText}`);
  }
  if (!viewDatesAdjustedText.startsWith('Zodiac:') || !viewDatesAdjustedText.includes('1970')) {
    throw new Error(`Expected viewDatesAdjusted to show "Zodiac: ... 1970 ...", got: ${viewDatesAdjustedText}`);
  }
  console.log('Confirmed: Person View shows both dates, clearly labeled, neither hidden.');

  console.log('\n=== A person with NO zodiac set shows only the plain date (no "Doc." label, no second line) ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('nameInput').textContent = 'No Zodiac Person'; document.getElementById('nameInput').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#birthInput', '1980-05-05');
  await page.locator('#birthInput').dispatchEvent('change');
  // Explicitly clear the auto-filled zodiac back to "no zodiac".
  await page.selectOption('#zodiacInput', '');
  await page.waitForTimeout(100);
  const hintHiddenNoZodiac = await page.evaluate(() => document.getElementById('zodiacAdjustedHint').hidden);
  if (!hintHiddenNoZodiac) throw new Error('Expected the zodiac-adjusted hint to be hidden with no zodiac selected');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);
  const cardBox2 = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.person-card')).find(c => c.querySelector('.person-name').textContent === 'No Zodiac Person');
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(cardBox2.x + cardBox2.w / 2, cardBox2.y + cardBox2.h / 2);
  await page.waitForTimeout(300);
  const viewDatesText2 = await page.evaluate(() => document.getElementById('viewDates').textContent);
  const viewDatesAdjustedHidden2 = await page.evaluate(() => document.getElementById('viewDatesAdjusted').hidden);
  console.log('viewDates (no zodiac):', JSON.stringify(viewDatesText2), 'adjusted hidden:', viewDatesAdjustedHidden2);
  if (viewDatesText2.startsWith('Doc.:')) throw new Error(`Expected plain date text with no "Documented:" label when no zodiac is set, got: ${viewDatesText2}`);
  if (!viewDatesAdjustedHidden2) throw new Error('Expected the zodiac-adjusted line to stay hidden when no zodiac is set');
  console.log('Confirmed: no zodiac set means no extra labeling, just the plain date as before.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
