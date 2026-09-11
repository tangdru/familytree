import { chromium } from 'playwright-core';

const p1='p1', p2='p2', p3='p3', kid='kid';
const people = {
  [p1]: { id: p1, name: 'Parent One', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [p2]: { id: p2, name: 'Parent Two', birthDate: '1961-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [p3]: { id: p3, name: 'Parent Three', birthDate: '1962-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [kid]: { id: kid, name: 'Triple Kid', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [p1, p2, p3], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Triple Kid")');
  await page.waitForTimeout(200);
  const parentsListNames = await page.evaluate(() => Array.from(document.querySelectorAll('#viewParentsList .view-relation-link')).map(a => a.textContent));
  console.log('Parents relation list (expect all 3):', JSON.stringify(parentsListNames));
  if (parentsListNames.length !== 3) throw new Error('Expected all 3 parents to show in the relation list');

  const zoneCenter = () => page.evaluate(() => {
    const r = document.getElementById('viewSwipeZone').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const z = await zoneCenter();
  await page.mouse.move(z.x, z.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.move(z.x, z.y + 150, { steps: 10 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const coupleMembers = await page.evaluate(() => document.querySelectorAll('#viewPhotoPair .view-photo-pair-member').length);
  console.log('Couple card photo-pair members after swiping down (expect exactly 2):', coupleMembers);
  if (coupleMembers !== 2) throw new Error('Expected the couple card to cap at 2 members even with 3 recorded parents');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
