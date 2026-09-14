import { chromium } from 'playwright-core';

const alice = 'alice', bob = 'bob';
const people = {
  [alice]: { id: alice, name: 'Alice Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: 'legacy note text', parents: [], spouses: [] },
  [bob]: { id: bob, name: 'Bob Doe', birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  console.log('=== A legacy "notes" value migrates into a first story ===');
  await page.click('.person-card:has-text("Alice Doe")');
  await page.waitForTimeout(200);
  const legacyText = await page.locator('.story-text').first().textContent();
  if (!legacyText.includes('legacy note text')) throw new Error(`Expected legacy notes to migrate into a story, got: ${legacyText}`);
  console.log('Confirmed: old notes text now shows up as a story.');

  console.log('\n=== Adding a story with an @mention inserts a token and renders a link ===');
  await page.click('#viewCloseBtn');
  await page.click('.person-card:has-text("Bob Doe")');
  await page.waitForTimeout(200);
  await page.click('#addStoryBtn');
  await page.waitForTimeout(100);
  const textarea = page.locator('.story-editor-textarea');
  await textarea.fill('Hi @Alice');
  await page.waitForTimeout(150);
  if (!(await page.locator('.story-mention-dropdown').isVisible())) throw new Error('Expected the mention dropdown to appear while typing @Alice');
  await page.click('.story-mention-option:has-text("Alice Doe")');
  const value = await textarea.inputValue();
  if (!value.includes(`@[Alice Doe](${alice})`)) throw new Error(`Expected a mention token to be inserted, got: ${value}`);
  await textarea.type(' this is a test story.');
  await page.click('.story-editor-footer .btn-primary');
  await page.waitForTimeout(300);

  if (await page.locator('.story-card').count() !== 1) throw new Error('Expected exactly one story on Bob after saving');
  if (!(await page.locator('.story-mention:has-text("@Alice Doe")').isVisible())) throw new Error('Expected the mention to render as a clickable link, not raw markup');
  console.log('Confirmed: mention autocomplete inserts a token that renders as a link.');

  console.log('\n=== Clicking a mention link navigates to that person\'s card ===');
  await page.click('.story-mention:has-text("@Alice Doe")');
  await page.waitForTimeout(200);
  const nameAfterMentionClick = await page.evaluate(() => document.getElementById('viewName').textContent);
  if (nameAfterMentionClick !== 'Alice Doe') throw new Error(`Expected clicking the mention to open Alice's card, got: ${nameAfterMentionClick}`);
  console.log('Confirmed: mention links navigate to the mentioned person.');

  console.log('\n=== The mentioned person gets a "Mentioned in" backlink, not a duplicated story ===');
  if (!(await page.locator('#viewMentionedSection').isVisible())) throw new Error('Expected the Mentioned-in section to be visible on Alice\'s card');
  const backlinkText = await page.locator('#viewMentionedList').textContent();
  if (!backlinkText.includes('Bob Doe')) throw new Error(`Expected the backlink to name Bob Doe, got: ${backlinkText}`);
  if (await page.locator('#viewStoriesList .story-card').count() !== 1) throw new Error('Expected Alice\'s own Stories list to be unaffected (just her migrated legacy note)');
  await page.click('#viewMentionedList .view-relation-link');
  await page.waitForTimeout(200);
  const nameAfterBacklinkClick = await page.evaluate(() => document.getElementById('viewName').textContent);
  if (nameAfterBacklinkClick !== 'Bob Doe') throw new Error(`Expected the backlink to navigate back to Bob, got: ${nameAfterBacklinkClick}`);
  console.log('Confirmed: the mention creates a live backlink instead of duplicating the story.');

  console.log('\n=== Editing a story prefills its text and updates it in place ===');
  await page.click('.story-edit-btn');
  await page.waitForTimeout(100);
  const editTextarea = page.locator('.story-editor-textarea');
  const editValue = await editTextarea.inputValue();
  if (!editValue.includes('this is a test story')) throw new Error(`Expected the editor to prefill the existing story text, got: ${editValue}`);
  await editTextarea.fill('Edited story text');
  await page.click('.story-editor-footer .btn-primary');
  await page.waitForTimeout(300);
  const editedText = await page.locator('.story-text').first().textContent();
  if (!editedText.includes('Edited story text')) throw new Error(`Expected the story text to be updated, got: ${editedText}`);
  console.log('Confirmed: editing a story updates it rather than creating a new one.');

  console.log('\n=== Deleting a story removes it and shows the empty state ===');
  page.once('dialog', d => d.accept());
  await page.click('.story-delete-btn');
  await page.waitForTimeout(300);
  if (await page.locator('.story-card').count() !== 0) throw new Error('Expected the story to be gone after confirming delete');
  if (!(await page.locator('.story-empty-hint').isVisible())) throw new Error('Expected an empty-state hint once the only story is deleted');
  console.log('Confirmed: deleting a story removes it and the empty state reappears.');

  console.log('\n=== Cancel discards an in-progress add without creating a story ===');
  await page.click('#addStoryBtn');
  await page.waitForTimeout(100);
  await page.fill('.story-editor-textarea', 'Never saved');
  await page.click('.story-editor-footer .btn:not(.btn-primary)');
  await page.waitForTimeout(200);
  if (await page.locator('.story-card').count() !== 0) throw new Error('Expected Cancel to discard the draft instead of saving it');
  if (!(await page.locator('#addStoryBtn').isVisible())) throw new Error('Expected the Add story button to reappear after cancelling');
  console.log('Confirmed: Cancel discards the draft.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
