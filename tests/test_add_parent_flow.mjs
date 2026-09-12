import { chromium } from 'playwright-core';

// Mirrors test_add_spouse_flow.mjs's "+ Add new spouse" flow, but for the
// Parent(s) combo -- same stash-and-repurpose modal trick (startAddParentFlow
// in app.js), minus the current/former confirm step spouses go through,
// since a parent chip has no status to confirm.
const people = {
  jane: { id: 'jane', name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  console.log('=== Edit Jane, change her notes (unsaved), then add a brand-new parent ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  // Make an in-progress, unsaved edit that must survive the nested add.
  await page.fill('#notesInput', 'Grew up in Boston.');

  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(150);
  const createLabel = await page.textContent('.combo-option-create');
  console.log('pinned option label:', createLabel);
  if (!createLabel.includes('Add new parent')) throw new Error('Expected the pinned "+ Add new parent" row');
  await page.click('.combo-option-create');
  await page.waitForTimeout(200);

  const nestedTitle = await page.textContent('#modalTitle');
  console.log('nested modal title (expect Add Parent):', nestedTitle);
  if (nestedTitle !== 'Add Parent') throw new Error('Expected nested modal titled "Add Parent"');

  // Fill out the new parent and save -- this should return to Jane's edit
  // form with the notes edit still intact and Susan now a parent chip,
  // with no current/former confirm step (parents don't have that status).
  await page.click('#nameInput');
  await page.keyboard.type('Susan Hart');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);

  const afterState = await page.evaluate(() => ({
    modalTitle: document.getElementById('modalTitle').textContent,
    modalHidden: document.getElementById('personModal').hidden,
    notes: document.getElementById('notesInput').value,
    chips: Array.from(document.querySelectorAll('#parentsChips .chip')).map(c => c.textContent.replace('✕', '').trim()),
    personId: document.getElementById('personId').value,
  }));
  console.log('after nested save, back in outer form:', JSON.stringify(afterState));
  if (afterState.modalHidden) throw new Error('Expected the modal to still be open (back in the outer edit)');
  if (afterState.modalTitle !== 'Edit Person') throw new Error('Expected to be back in "Edit Person" for Jane');
  if (afterState.notes !== 'Grew up in Boston.') throw new Error('Expected the unsaved notes edit to survive the nested add');
  if (!afterState.chips.some(c => c.includes('Susan Hart'))) throw new Error('Expected Susan Hart to appear as a parent chip');

  console.log('\n=== Save Jane for real, confirm the parent link persisted ===');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const dataAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  const jane = Object.values(dataAfterSave).find(p => p.name === 'Jane Doe');
  const susan = Object.values(dataAfterSave).find(p => p.name === 'Susan Hart');
  console.log('jane.parents includes susan:', jane.parents.includes(susan.id));
  if (!jane.parents.includes(susan.id)) throw new Error('Expected Susan to be recorded as one of Jane\'s parents');
  console.log('jane.notes persisted:', jane.notes);
  if (jane.notes !== 'Grew up in Boston.') throw new Error('Expected Jane\'s notes edit to have actually saved');

  console.log('\n=== Cancel out of a nested add-parent: should return to the outer edit, not close everything ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(150);
  await page.click('.combo-option-create');
  await page.waitForTimeout(200);
  await page.click('#cancelBtn');
  await page.waitForTimeout(200);
  const afterCancel = await page.evaluate(() => ({
    modalHidden: document.getElementById('personModal').hidden,
    modalTitle: document.getElementById('modalTitle').textContent,
  }));
  console.log(JSON.stringify(afterCancel));
  if (afterCancel.modalHidden) throw new Error('Expected Cancel from the nested step to return to the outer edit, not close it');
  if (afterCancel.modalTitle !== 'Edit Person') throw new Error('Expected to be back editing Jane after cancelling the nested add');
  // A second Cancel should now actually close the modal.
  await page.click('#cancelBtn');
  await page.waitForTimeout(150);
  const afterSecondCancel = await page.evaluate(() => document.getElementById('personModal').hidden);
  console.log('modal hidden after second cancel (expect true):', afterSecondCancel);
  if (!afterSecondCancel) throw new Error('Expected the second Cancel to actually close the modal');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
