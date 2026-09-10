import { chromium } from 'playwright-core';

const people = {
  michael: { id: 'michael', name: 'Michael Doe', birthDate: '1959-01-01', deathDate: '', photo: '', notes: '', location: 'Chicago', parents: [], spouses: [] },
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

  console.log('=== Edit Michael, change his notes (unsaved), then add a brand-new spouse ===');
  await page.click('.person-card:has-text("Michael Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  // Make an in-progress, unsaved edit that must survive the nested add.
  await page.fill('#notesInput', 'Loves hiking.');

  await page.click('#spousesCombo .combo-trigger');
  await page.waitForTimeout(150);
  const createLabel = await page.textContent('.combo-option-create');
  console.log('pinned option label:', createLabel);
  if (!createLabel.includes('Add new spouse')) throw new Error('Expected the pinned "+ Add new spouse" row');
  await page.click('.combo-option-create');
  await page.waitForTimeout(200);

  const nestedTitle = await page.textContent('#modalTitle');
  console.log('nested modal title (expect Add Spouse):', nestedTitle);
  if (nestedTitle !== 'Add Spouse') throw new Error('Expected nested modal titled "Add Spouse"');
  const deleteHiddenNested = await page.getAttribute('#deletePersonBtn', 'hidden');
  console.log('delete button hidden in nested add (expect true/non-null):', deleteHiddenNested);

  // Fill out the new spouse and save -- this should return to Michael's
  // edit form with the notes edit still intact and Susan now a spouse chip.
  await page.click('#nameInput');
  await page.keyboard.type('Susan Hart');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  // New: adding a spouse (existing or brand-new) now asks current/former
  // before the chip appears.
  await page.click('#spousesConfirmCurrent');
  await page.waitForTimeout(200);

  const afterState = await page.evaluate(() => ({
    modalTitle: document.getElementById('modalTitle').textContent,
    modalHidden: document.getElementById('personModal').hidden,
    notes: document.getElementById('notesInput').value,
    chips: Array.from(document.querySelectorAll('#spousesChips .chip')).map(c => c.textContent.replace('✕', '').trim()),
    personId: document.getElementById('personId').value,
  }));
  console.log('after nested save, back in outer form:', JSON.stringify(afterState));
  if (afterState.modalHidden) throw new Error('Expected the modal to still be open (back in the outer edit)');
  if (afterState.modalTitle !== 'Edit Person') throw new Error('Expected to be back in "Edit Person" for Michael');
  if (afterState.notes !== 'Loves hiking.') throw new Error('Expected the unsaved notes edit to survive the nested add');
  if (!afterState.chips.some(c => c.includes('Susan Hart'))) throw new Error('Expected Susan Hart to appear as a spouse chip');

  // Now save Michael for real, and confirm the couple card + bidirectional
  // spouse link both come out correctly.
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  const dataAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  const michael = Object.values(dataAfterSave).find(p => p.name === 'Michael Doe');
  const susan = Object.values(dataAfterSave).find(p => p.name === 'Susan Hart');
  console.log('michael.spouses includes susan:', michael.spouses.includes(susan.id));
  console.log('susan.spouses includes michael:', susan.spouses.includes(michael.id));
  if (!michael.spouses.includes(susan.id) || !susan.spouses.includes(michael.id)) {
    throw new Error('Expected a symmetric spouse link between Michael and Susan');
  }
  console.log('michael.notes persisted:', michael.notes);
  if (michael.notes !== 'Loves hiking.') throw new Error('Expected Michael\'s notes edit to have actually saved');

  console.log('\n=== Saving returned to Michael\'s view -- should now show the couple card with Susan ===');
  const viewState = await page.evaluate(() => ({
    mode: document.getElementById('viewCouple').hidden ? 'single' : 'couple',
    members: Array.from(document.querySelectorAll('.view-couple-member .view-couple-name')).map(n => n.textContent),
  }));
  console.log(JSON.stringify(viewState));
  if (viewState.mode !== 'couple' || !viewState.members.includes('Susan Hart')) {
    throw new Error('Expected Michael to now show as a couple card with Susan');
  }

  console.log('\n=== Cancel out of a nested add-spouse: should return to the outer edit, not close everything ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Michael Doe")');
  await page.waitForTimeout(200);
  // We're in couple mode now; use the Edit button to edit Michael specifically.
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#spousesCombo .combo-trigger');
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
  if (afterCancel.modalTitle !== 'Edit Person') throw new Error('Expected to be back editing Michael after cancelling the nested add');
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
