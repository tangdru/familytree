import { chromium } from 'playwright-core';

// A tiny valid 1x1 PNG, standing in for a cropped photo's data URL.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: TINY_PNG, notes: '', parents: [], spouses: [] },
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
  await page.waitForTimeout(500); // let the Supabase-unreachable fallback to local mode settle

  console.log('=== No global "Saved" toast element exists anymore ===');
  const toastExists = await page.evaluate(() => !!document.getElementById('saveToast'));
  console.log('saveToast element present:', toastExists);
  if (toastExists) throw new Error('Expected the removed save-toast element to be gone from the DOM');

  console.log('\n=== Local-only mode (no reachable Supabase here): editing an unrelated field leaves an existing photo untouched ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.fill('#notesInput', 'Loves tea.');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  const afterUnrelatedEdit = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('photo unchanged:', afterUnrelatedEdit.photo === TINY_PNG, '| notes:', afterUnrelatedEdit.notes);
  if (afterUnrelatedEdit.photo !== TINY_PNG) throw new Error('Expected the existing photo to survive an unrelated edit');
  if (afterUnrelatedEdit.notes !== 'Loves tea.') throw new Error('Expected the notes edit to have saved');

  console.log('\n=== Removing the photo via the edit form clears it on save ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const removeBtnHidden = await page.getAttribute('#removePhotoBtn', 'hidden');
  console.log('remove-photo button hidden (expect null -- a photo is set):', removeBtnHidden);
  if (removeBtnHidden !== null) throw new Error('Expected the remove-photo button to be visible when a photo is set');
  await page.click('#removePhotoBtn');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  const afterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1.photo);
  console.log('photo after removal (expect empty string):', JSON.stringify(afterRemove));
  if (afterRemove !== '') throw new Error('Expected the photo to be cleared after removal + save');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
