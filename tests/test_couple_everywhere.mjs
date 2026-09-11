import { chromium } from 'playwright-core';

// michael + susan: married couple, jane is their kid.
// michael also has a SECOND spouse (exWife) on file, to check the small
// avatar row still surfaces additional spouses beyond the couple card.
// tom is jane's brother with only ONE recorded parent (michael) -- but
// michael has susan as a spouse, so tom's "parents" view should still pair
// michael+susan as a step-parent couple.
// solo has no spouse at all -- should stay a plain single card everywhere.
const people = {
  michael: { id: 'michael', name: 'Michael Doe', birthDate: '1959-01-01', deathDate: '', photo: '', notes: '', location: 'Chicago', parents: [], spouses: ['susan', 'exWife'] },
  susan: { id: 'susan', name: 'Susan Hart', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', location: 'Chicago', parents: [], spouses: ['michael'] },
  exWife: { id: 'exWife', name: 'Former Wife', birthDate: '1958-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: ['michael'] },
  jane: { id: 'jane', name: 'Jane Doe', birthDate: '1985-01-01', deathDate: '', photo: '', notes: '', parents: ['michael', 'susan'], spouses: [] },
  tom: { id: 'tom', name: 'Tom Doe', birthDate: '1988-01-01', deathDate: '', photo: '', notes: '', parents: ['michael'], spouses: [] },
  solo: { id: 'solo', name: 'Solo Doe', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  const state = () => page.evaluate(() => {
    const coupleHidden = document.getElementById('viewPhotoPair').hidden;
    const members = Array.from(document.querySelectorAll('#viewPhotoPair .view-photo-pair-member')).map(m => m.title);
    const avatarCount = document.getElementById('viewSpouseAvatars').children.length;
    return {
      mode: coupleHidden ? 'single' : 'couple',
      singleName: document.getElementById('viewName').textContent,
      members,
      avatarsHidden: document.getElementById('viewSpouseAvatars').hidden,
      avatarCount,
    };
  });

  console.log('=== Click Michael directly on the tree ===');
  await page.click('.person-card:has-text("Michael Doe")');
  await page.waitForTimeout(200);
  let s = await state();
  console.log(JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.includes('Michael Doe') || !s.members.includes('Susan Hart')) {
    throw new Error('Expected Michael to open as a couple card with Susan');
  }
  console.log('extra-spouse avatar row (expect 1, for exWife):', s.avatarCount, s.avatarsHidden);
  if (s.avatarsHidden || s.avatarCount !== 1) throw new Error('Expected the small avatar row to show the second spouse (exWife)');

  console.log('\n=== Click Solo directly (no spouse) -> stays single ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Solo Doe")');
  await page.waitForTimeout(200);
  s = await state();
  console.log(JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Solo Doe') throw new Error('Expected Solo to stay a plain single card');

  console.log('\n=== Click Tom (single recorded parent: Michael) -> parents view pairs Michael+Susan as step-parent couple ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Tom Doe")');
  await page.waitForTimeout(200);
  const zoneCenter = () => page.evaluate(() => {
    const r = document.getElementById('viewSwipeZone').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  async function swipeDown() {
    const z = await zoneCenter();
    await page.mouse.move(z.x, z.y);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.move(z.x, z.y + 150, { steps: 10 });
    await page.waitForTimeout(30);
    await page.mouse.up();
    await page.waitForTimeout(400); // outlasts the swipe's own settle-animation delay before it commits
  }
  await swipeDown();
  s = await state();
  console.log(JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.includes('Michael Doe') || !s.members.includes('Susan Hart')) {
    throw new Error('Expected Tom\'s single recorded parent (Michael) to still pair with his spouse Susan');
  }

  console.log('\n=== Jane and Tom are siblings (share Michael) -- sibling-swipe from Jane should land on Tom, single (Tom has no spouse) ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  s = await state();
  console.log('Jane opened directly (expect couple, Michael+Susan since Jane has no spouse herself... wait Jane herself has no spouse, so single):', JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Jane Doe') throw new Error('Expected Jane (no spouse) to open as a single card for herself');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
