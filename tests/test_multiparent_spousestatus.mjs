import { chromium } from 'playwright-core';

const gp='gp', bio='bio', step='step', ex='ex', kid='kid';
const people = {
  [gp]: { id: gp, name: 'Grandpa Doe', birthDate: '1930-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [bio]: { id: bio, name: 'Bio Parent', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', parents: [gp], spouses: [step, ex], spouseStatus: { [step]: 'current', [ex]: 'former' } },
  [step]: { id: step, name: 'Step Parent', birthDate: '1962-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [bio], spouseStatus: { [bio]: 'current' } },
  [ex]: { id: ex, name: 'Ex Partner', birthDate: '1959-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [bio], spouseStatus: { [bio]: 'former' } },
  [kid]: { id: kid, name: 'The Kid', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [bio], spouses: [] },
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

  const cardState = () => page.evaluate(() => ({
    mode: document.getElementById('viewPhotoPair').hidden ? 'single' : 'couple',
    singleName: document.getElementById('viewName').textContent,
    members: Array.from(document.querySelectorAll('#viewPhotoPair .view-photo-pair-member')).map(m => m.title),
  }));

  console.log('=== BioParent has a current (Step) and a former (Ex) spouse -- should pair with Step, not Ex ===');
  await page.click('.person-card:has-text("Bio Parent")');
  await page.waitForTimeout(200);
  let s = await cardState();
  console.log(JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.includes('Step Parent') || s.members.includes('Ex Partner')) {
    throw new Error('Expected BioParent to pair with the CURRENT spouse (Step), not the former (Ex)');
  }

  console.log('\n=== Kid has one recorded parent (BioParent) -> step-parent inference should also prefer Step over Ex ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("The Kid")');
  await page.waitForTimeout(200);
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
  s = await cardState();
  console.log(JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.includes('Step Parent')) {
    throw new Error('Expected Kid\'s single recorded parent to pair with the CURRENT step-parent (Step)');
  }

  console.log('\n=== Ex Partner opened directly: their only spouse link (BioParent) is former -> single card ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Ex Partner")');
  await page.waitForTimeout(200);
  s = await cardState();
  console.log(JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Ex Partner') {
    throw new Error('Expected Ex Partner to render as a plain single card (no current spouse)');
  }

  console.log('\n=== Edit form: multi-parent selector + spouse status toggle + bidirectional former-wins ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("The Kid")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  // Add a second parent to Kid via the unified Parents chips field.
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(150);
  await page.click('.combo-option:has-text("Step Parent")');
  await page.waitForTimeout(150);
  const parentChips = await page.evaluate(() => Array.from(document.querySelectorAll('#parentsChips .chip-name')).map(n => n.textContent));
  console.log('Kid\'s parent chips after adding Step Parent:', JSON.stringify(parentChips));
  if (!parentChips.includes('Bio Parent') || !parentChips.includes('Step Parent')) {
    throw new Error('Expected Kid to now have two recorded parents: Bio Parent and Step Parent');
  }

  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const savedKid = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.kid);
  console.log('Kid.parents after save:', JSON.stringify(savedKid.parents));
  if (savedKid.parents.length !== 2) throw new Error('Expected Kid to have 2 saved parents');

  console.log('\n=== Now edit Ex Partner and mark them current toward BioParent -- BioParent still has them former, so final should stay former ===');
  // Saving Kid's edit above returned to Kid's own Person View (saving an
  // existing person now reopens their view instead of dropping to the
  // tree) -- close that before reaching Ex Partner's card.
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Ex Partner")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const statusLabel = await page.evaluate(() => document.querySelector('#spousesChips .chip-status')?.textContent);
  console.log('Ex Partner\'s own chip for Bio Parent currently shows:', statusLabel);
  if (statusLabel !== 'Former') throw new Error('Expected Ex Partner\'s chip toward Bio Parent to start as Former');
  await page.click('#spousesChips .chip-status');
  await page.waitForTimeout(100);
  const afterToggle = await page.evaluate(() => document.querySelector('#spousesChips .chip-status')?.textContent);
  console.log('after tapping the toggle (this side now says):', afterToggle);
  if (afterToggle !== 'Current') throw new Error('Expected the toggle to flip to Current on this side');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const dataAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  console.log('Ex Partner.spouseStatus:', JSON.stringify(dataAfter.ex.spouseStatus));
  console.log('BioParent.spouseStatus:', JSON.stringify(dataAfter.bio.spouseStatus));
  if (dataAfter.ex.spouseStatus.bio !== 'former' || dataAfter.bio.spouseStatus.ex !== 'former') {
    throw new Error('Expected the relationship to stay FORMER on both sides -- one side calling it current should not override the other calling it former');
  }

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
