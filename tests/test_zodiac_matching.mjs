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

  console.log('=== Documented 1970-01-01 (a real Dog year) + Dog selected: dates already align ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('nameInput').textContent = 'Aligned Person'; document.getElementById('nameInput').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#birthInput', '1970-01-01');
  await page.locator('#birthInput').dispatchEvent('change');
  await page.selectOption('#zodiacInput', 'Dog');
  await page.waitForTimeout(100);

  const hintHidden = await page.evaluate(() => document.getElementById('zodiacAdjustedHint').hidden);
  console.log('form hint hidden (should be true, no correction needed):', hintHidden);
  if (!hintHidden) throw new Error('Expected the zodiac-adjusted hint to stay hidden when the documented year already matches the sign');

  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);

  const cardBox = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.person-card')).find(c => c.querySelector('.person-name').textContent === 'Aligned Person');
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(cardBox.x + cardBox.w / 2, cardBox.y + cardBox.h / 2);
  await page.waitForTimeout(300);
  const detailLines = await page.evaluate(() => Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent));
  console.log('detail lines:', JSON.stringify(detailLines));
  if (detailLines.some(l => l.startsWith('Documented:') || l.startsWith('Zodiac-adjusted:'))) {
    throw new Error(`Expected a single plain "Born ..." line (no Documented:/Zodiac-adjusted: split) when both align, got: ${JSON.stringify(detailLines)}`);
  }
  if (!detailLines.some(l => l.startsWith('Born '))) throw new Error(`Expected a plain "Born ..." line, got: ${JSON.stringify(detailLines)}`);
  console.log('Confirmed: aligned dates collapse to a single plain birthday line, no redundant second line.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
