import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Editing an existing person: Save should close the Edit modal and reopen the Person View, not the tree ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.fill('#notesInput', 'Loves hiking.');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(150);

  const state = await page.evaluate(() => ({
    editModalHidden: document.getElementById('personModal').hidden,
    viewModalHidden: document.getElementById('personViewModal').hidden,
    viewName: document.getElementById('viewName').textContent,
    viewNotes: document.getElementById('viewNotes').textContent,
  }));
  console.log(JSON.stringify(state));
  if (!state.editModalHidden) throw new Error('Expected the Edit modal to be closed');
  if (state.viewModalHidden) throw new Error('Expected the Person View modal to be open after saving an edit');
  if (state.viewName !== 'Jane Doe') throw new Error('Expected the view to show the just-edited person');
  if (state.viewNotes !== 'Loves hiking.') throw new Error('Expected the view to reflect the just-saved edit');

  console.log('\n=== Adding a brand-new person: should still land on the tree (highlighted), not a view card (nothing to view back to) ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.click('#nameInput');
  await page.keyboard.type('New Person');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(150);
  const addState = await page.evaluate(() => ({
    editModalHidden: document.getElementById('personModal').hidden,
    viewModalHidden: document.getElementById('personViewModal').hidden,
  }));
  console.log(JSON.stringify(addState));
  if (!addState.editModalHidden || !addState.viewModalHidden) throw new Error('Expected adding a new person to land back on the tree, not open a view card');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
