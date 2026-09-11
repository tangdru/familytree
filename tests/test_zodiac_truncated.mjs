import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 750 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript(() => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({
      people: {
        eleanor: { id: 'eleanor', name: 'Eleanor Hayes', birthDate: '1948-03-12', deathDate: '', zodiac: 'Goat', photo: '', notes: '', parents: [], spouses: ['walter'], locations: [], birthLocation: '', contacts: [] },
        walter: { id: 'walter', name: 'Walter Hayes', birthDate: '1945-09-02', deathDate: '', zodiac: '', photo: '', notes: '', parents: [], spouses: ['eleanor'], locations: [], birthLocation: '', contacts: [] },
        thomas: { id: 'thomas', name: 'Thomas Hayes', birthDate: '1975-01-01', deathDate: '', zodiac: 'Dog', photo: '', notes: '', parents: [], spouses: [], locations: [], birthLocation: '', contacts: [] },
      },
    }));
  });
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Add/Edit form: still uses the FULL terms, unchanged ===');
  await page.click('.person-card[data-id="thomas"]');
  await page.waitForTimeout(300);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(300);
  const formLabel = await page.evaluate(() => document.querySelector('label[for="birthInput"]').textContent);
  const formHint = await page.evaluate(() => document.getElementById('zodiacAdjustedHint').textContent);
  console.log('form label:', formLabel, '| form hint:', formHint);
  if (formLabel !== 'Documented birthday') throw new Error(`Expected the form label to stay "Documented birthday", got: ${formLabel}`);
  if (!formHint.startsWith('Zodiac-adjusted birthday:')) throw new Error(`Expected the form hint to stay spelled out, got: ${formHint}`);
  console.log('Confirmed: Add/Edit form text is untouched.');
  await page.click('#cancelBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Single Person View: grouped details block uses full "Documented:/Zodiac-adjusted:" labels ===');
  await page.click('.person-card[data-id="thomas"]');
  await page.waitForTimeout(300);
  const detailLines = await page.evaluate(() => Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent));
  console.log('detail lines:', JSON.stringify(detailLines));
  if (!detailLines.some(l => l.startsWith('Documented:'))) throw new Error(`Expected a "Documented:" line, got: ${JSON.stringify(detailLines)}`);
  if (!detailLines.some(l => l.startsWith('Zodiac-adjusted:'))) throw new Error(`Expected a "Zodiac-adjusted:" line, got: ${JSON.stringify(detailLines)}`);
  console.log('Confirmed: single Person View uses the full labels.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Couple View: also uses truncated "Doc./Zodiac" ===');
  await page.click('.person-card[data-id="eleanor"]');
  await page.waitForTimeout(300);
  const coupleLines = await page.evaluate(() => {
    const eleanorMember = Array.from(document.querySelectorAll('.view-couple-member')).find(m => m.querySelector('.view-couple-name').textContent === 'Eleanor Hayes');
    return Array.from(eleanorMember.querySelectorAll('.view-couple-dates')).map(d => d.textContent);
  });
  console.log('Eleanor couple lines:', JSON.stringify(coupleLines));
  if (!coupleLines[0].startsWith('Doc.:')) throw new Error(`Expected "Doc.:" prefix in couple card, got: ${coupleLines[0]}`);
  if (!coupleLines[1].startsWith('Zodiac:')) throw new Error(`Expected "Zodiac:" prefix in couple card, got: ${coupleLines[1]}`);
  console.log('Confirmed: Couple View also uses the truncated labels.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
