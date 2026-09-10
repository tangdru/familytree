import { chromium } from 'playwright-core';

const a='a', b='b';
const people = {
  [a]: { id: a, name: 'Alex Doe', birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [b]: { id: b, name: 'Blair Existing', birthDate: '1982-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Pick an EXISTING person as spouse: confirm prompt should appear before the chip is added ===');
  await page.click('.person-card:has-text("Alex Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#spousesCombo .combo-trigger');
  await page.waitForTimeout(150);
  await page.click('.combo-option:has-text("Blair Existing")');
  await page.waitForTimeout(150);

  let state = await page.evaluate(() => ({
    confirmHidden: document.getElementById('spousesConfirm').hidden,
    confirmName: document.getElementById('spousesConfirmName').textContent,
    chips: Array.from(document.querySelectorAll('#spousesChips .chip-name')).map(n => n.textContent),
    optionsHidden: document.querySelector('#spousesDropdown .combo-options').hidden,
  }));
  console.log(JSON.stringify(state));
  if (state.confirmHidden) throw new Error('Expected the confirm panel to be showing');
  if (state.confirmName !== 'Blair Existing') throw new Error('Expected the confirm panel to name Blair Existing');
  if (state.chips.length !== 0) throw new Error('Expected no chip yet -- not confirmed');
  if (!state.optionsHidden) throw new Error('Expected the options list to be hidden while confirming');

  // Check "Current" is the visually pre-highlighted button (btn-primary).
  const currentIsPrimary = await page.evaluate(() => document.getElementById('spousesConfirmCurrent').classList.contains('btn-primary'));
  console.log('Current button pre-highlighted (btn-primary):', currentIsPrimary);
  if (!currentIsPrimary) throw new Error('Expected the Current button to be pre-highlighted');

  await page.click('#spousesConfirmFormer');
  await page.waitForTimeout(150);
  state = await page.evaluate(() => ({
    confirmHidden: document.getElementById('spousesConfirm').hidden,
    chips: Array.from(document.querySelectorAll('#spousesChips .chip-name')).map(n => n.textContent),
    statusLabel: document.querySelector('#spousesChips .chip-status')?.textContent,
  }));
  console.log('after tapping Former:', JSON.stringify(state));
  if (state.chips.length !== 1 || state.chips[0] !== 'Blair Existing') throw new Error('Expected Blair Existing to now be a chip');
  if (state.statusLabel !== 'Former') throw new Error('Expected the new chip\'s status to already read Former');

  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  console.log('Alex.spouseStatus:', JSON.stringify(saved.a.spouseStatus));
  if (saved.a.spouseStatus.b !== 'former') throw new Error('Expected the saved status to be former');

  console.log('\n=== "+ Add new spouse" flow: confirm prompt should appear for the brand-new person too ===');
  // Saving Alex above returned straight to Alex's own Person View (saving
  // an existing person now reopens their view instead of the tree).
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#spousesCombo .combo-trigger');
  await page.waitForTimeout(150);
  await page.click('.combo-option-create');
  await page.waitForTimeout(200);
  await page.click('#nameInput');
  await page.keyboard.type('Casey New');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);

  state = await page.evaluate(() => ({
    confirmHidden: document.getElementById('spousesConfirm').hidden,
    confirmName: document.getElementById('spousesConfirmName').textContent,
    chips: Array.from(document.querySelectorAll('#spousesChips .chip-name')).map(n => n.textContent),
  }));
  console.log(JSON.stringify(state));
  if (state.confirmHidden) throw new Error('Expected the confirm panel to show for the newly created spouse');
  if (state.confirmName !== 'Casey New') throw new Error('Expected the confirm panel to name Casey New');
  if (state.chips.includes('Casey New')) throw new Error('Expected Casey New NOT to be a chip yet -- not confirmed');

  await page.click('#spousesConfirmCurrent');
  await page.waitForTimeout(150);
  state = await page.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('#spousesChips .chip-name')).map(n => n.textContent),
    statusLabel: Array.from(document.querySelectorAll('#spousesChips .chip')).find(c => c.textContent.includes('Casey'))?.querySelector('.chip-status')?.textContent,
  }));
  console.log('after tapping Current:', JSON.stringify(state));
  if (!state.chips.includes('Casey New')) throw new Error('Expected Casey New to now be a chip');
  if (state.statusLabel !== 'Current') throw new Error('Expected Casey New\'s chip to read Current');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
