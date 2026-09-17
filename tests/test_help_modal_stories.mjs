import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  console.log('=== The Help guide has a Stories section, right after Viewing a profile ===');
  await page.click('#helpBtn');
  await page.waitForTimeout(200);
  const sections = await page.evaluate(() => Array.from(document.querySelectorAll('.help-section h3')).map(h => h.textContent));
  console.log('Section order:', JSON.stringify(sections));
  const storiesIdx = sections.indexOf('Stories');
  const profileIdx = sections.indexOf('Viewing a profile');
  if (storiesIdx === -1) throw new Error('Expected a "Stories" section in the Help guide');
  if (storiesIdx !== profileIdx + 1) throw new Error('Expected Stories to come right after Viewing a profile');

  const storiesText = await page.evaluate(() => {
    const h3s = Array.from(document.querySelectorAll('.help-section h3'));
    const section = h3s.find(h => h.textContent === 'Stories')?.closest('.help-section');
    return section?.textContent || '';
  });
  console.log('Stories section text:', storiesText);
  if (!storiesText.includes('@')) throw new Error('Expected the Stories help text to mention @mentions');
  if (!storiesText.toLowerCase().includes('mentioned in')) throw new Error('Expected the Stories help text to mention the "Mentioned in" backlink');
  if (!storiesText.toLowerCase().includes('microphone') && !storiesText.toLowerCase().includes('voice')) {
    throw new Error('Expected the Stories help text to mention voice recording');
  }
  console.log('Confirmed: Stories help section exists with the right content.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
