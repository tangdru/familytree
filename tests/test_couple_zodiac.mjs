import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 750 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript(() => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({
      people: {
        eleanor: { id: 'eleanor', name: 'Eleanor Hayes', birthDate: '1948-03-12', deathDate: '', zodiac: 'Goat', photo: '', notes: '', parents: [], spouses: ['walter'], locations: ['Boston, USA'], birthLocation: '', contacts: ['eleanor.hayes@example.com'] },
        walter: { id: 'walter', name: 'Walter Hayes', birthDate: '1945-09-02', deathDate: '', zodiac: '', photo: '', notes: '', parents: [], spouses: ['eleanor'], locations: ['Boston, USA'], birthLocation: '', contacts: [] },
      },
    }));
  });
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Couple View: Eleanor (zodiac mismatch) shows Doc./Zodiac split ===');
  await page.click('.person-card[data-id="eleanor"]');
  await page.waitForTimeout(300);
  const memberTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.view-couple-member')).map(m => ({
      name: m.querySelector('.view-couple-name').textContent,
      dateLines: Array.from(m.querySelectorAll('.view-couple-dates')).map(d => d.textContent),
    }));
  });
  console.log(JSON.stringify(memberTexts, null, 2));

  const eleanor = memberTexts.find(m => m.name === 'Eleanor Hayes');
  const walter = memberTexts.find(m => m.name === 'Walter Hayes');
  if (eleanor.dateLines.length !== 2) throw new Error(`Expected Eleanor to show 2 date lines, got ${eleanor.dateLines.length}: ${JSON.stringify(eleanor.dateLines)}`);
  if (!eleanor.dateLines[0].startsWith('Doc.:') || !eleanor.dateLines[0].includes('1948')) {
    throw new Error(`Expected Eleanor's first line to be "Doc.: ... 1948 ...", got: ${eleanor.dateLines[0]}`);
  }
  if (!eleanor.dateLines[1].startsWith('Zodiac:') || !eleanor.dateLines[1].includes('1943')) {
    throw new Error(`Expected Eleanor's second line to be "Zodiac: ... 1943 ...", got: ${eleanor.dateLines[1]}`);
  }
  console.log('Confirmed: Eleanor (zodiac mismatch) shows both labeled lines in the couple card.');

  if (walter.dateLines.length !== 1) throw new Error(`Expected Walter (no zodiac) to show just 1 date line, got ${walter.dateLines.length}: ${JSON.stringify(walter.dateLines)}`);
  if (walter.dateLines[0].startsWith('Doc.:')) throw new Error(`Expected Walter's line to be plain (no zodiac set), got: ${walter.dateLines[0]}`);
  if (!walter.dateLines[0].includes('Age')) throw new Error(`Expected Walter's plain line to still include an age, got: ${walter.dateLines[0]}`);
  console.log('Confirmed: Walter (no zodiac) still shows the original single line with age, unaffected.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
