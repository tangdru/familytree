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

  console.log('=== Couple View: Eleanor (zodiac mismatch, selected by default) shows Documented:/Zodiac-adjusted: split in the shared details block ===');
  await page.click('.person-card[data-id="eleanor"]');
  await page.waitForTimeout(300);
  const detailLines = () => page.evaluate(() => Array.from(document.querySelectorAll('#viewDetails p')).map(p => p.textContent));

  let lines = await detailLines();
  console.log('Eleanor (selected) detail lines:', JSON.stringify(lines));
  const documentedLine = lines.find(l => l.startsWith('Documented:'));
  const adjustedLine = lines.find(l => l.startsWith('Zodiac-adjusted:'));
  if (!documentedLine || !documentedLine.includes('1948')) throw new Error(`Expected a "Documented: ... 1948 ..." line, got: ${JSON.stringify(lines)}`);
  if (!adjustedLine || !adjustedLine.includes('1943')) throw new Error(`Expected a "Zodiac-adjusted: ... 1943 ..." line, got: ${JSON.stringify(lines)}`);
  console.log('Confirmed: Eleanor (zodiac mismatch) shows both labeled lines in the couple card.');

  console.log('\n=== Selecting Walter (no zodiac set) instead: plain "Born ..." line, no Documented/Zodiac-adjusted split ===');
  await page.click('#viewPhotoPair .view-photo-pair-member[title="Walter Hayes"]');
  await page.waitForTimeout(200);
  lines = await detailLines();
  const meta = await page.textContent('#viewMeta');
  console.log('Walter (selected) detail lines:', JSON.stringify(lines), '| meta:', meta);
  if (lines.some(l => l.startsWith('Documented:') || l.startsWith('Zodiac-adjusted:'))) {
    throw new Error(`Expected Walter's details to be a plain line (no zodiac set), got: ${JSON.stringify(lines)}`);
  }
  if (!meta.includes('Age')) throw new Error(`Expected Walter's meta row to still include an age, got: ${meta}`);
  console.log('Confirmed: Walter (no zodiac) shows the plain form, unaffected, once selected.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
