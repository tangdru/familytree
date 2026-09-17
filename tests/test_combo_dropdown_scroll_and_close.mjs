import { chromium } from 'playwright-core';

// Two related parents/spouses combo fixes, reported from a real phone: (1)
// opening the dropdown (tapping "Add parent…"/"Add spouse/partner…", both
// near the bottom of a long form) could leave it opening mostly or
// entirely below the fold, with barely a search box visible above the
// footer and no way to see the actual list without a manual scroll. (2)
// picking a person used to leave the dropdown open (by design, so adding
// several in a row didn't mean reopening each time) -- now it closes once
// that pick is actually finalized, which for spouses means waiting for
// the Current/Former confirm (that panel lives inside the same dropdown,
// so closing any earlier would hide it before it could be answered).
const p1 = 'p1', p2 = 'p2';
const others = {};
for (let i = 0; i < 10; i++) {
  others[`o${i}`] = { id: `o${i}`, name: `Candidate Person ${i}`, birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] };
}
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [p2]: { id: p2, name: 'Blair Existing', birthDate: '1982-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  ...others,
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // Short viewport, same spirit as the reported phone screenshot -- the
  // combo triggers sit well below the fold to begin with.
  const page = await browser.newPage({ viewport: { width: 400, height: 650 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Opening the parents dropdown scrolls it fully into view ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(250);
  const parentsRects = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const d = r(document.getElementById('parentsDropdown'));
    const f = r(document.getElementById('personForm'));
    return { dropdownTop: d.top, dropdownBottom: d.bottom, formTop: f.top, formBottom: f.bottom };
  });
  console.log(JSON.stringify(parentsRects));
  if (parentsRects.dropdownTop < parentsRects.formTop - 1 || parentsRects.dropdownBottom > parentsRects.formBottom + 1) {
    throw new Error(`Expected the dropdown to be scrolled fully within #personForm's visible area, got ${JSON.stringify(parentsRects)}`);
  }
  console.log('Confirmed: opening the dropdown scrolls it fully into view.');

  console.log('\n=== Picking a parent closes the dropdown ===');
  await page.click('.combo-option:has-text("Candidate Person 0")');
  await page.waitForTimeout(150);
  const parentsDropdownHiddenAfterPick = await page.getAttribute('#parentsDropdown', 'hidden');
  const parentChips = await page.evaluate(() => Array.from(document.querySelectorAll('#parentsChips .chip-name')).map(n => n.textContent));
  console.log('dropdown hidden:', parentsDropdownHiddenAfterPick, 'chips:', JSON.stringify(parentChips));
  if (parentsDropdownHiddenAfterPick === null) throw new Error('Expected the parents dropdown to close after picking a person');
  if (!parentChips.includes('Candidate Person 0')) throw new Error('Expected the picked parent to appear as a chip');
  console.log('Confirmed: picking a parent closes the dropdown.');

  console.log('\n=== Picking a spouse: dropdown stays open through the current/former confirm, then closes ===');
  await page.click('#spousesCombo .combo-trigger');
  await page.waitForTimeout(200);
  const spousesRects = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const d = r(document.getElementById('spousesDropdown'));
    const f = r(document.getElementById('personForm'));
    return { dropdownTop: d.top, dropdownBottom: d.bottom, formTop: f.top, formBottom: f.bottom };
  });
  console.log(JSON.stringify(spousesRects));
  if (spousesRects.dropdownTop < spousesRects.formTop - 1 || spousesRects.dropdownBottom > spousesRects.formBottom + 1) {
    throw new Error(`Expected the spouses dropdown to also be scrolled fully into view, got ${JSON.stringify(spousesRects)}`);
  }
  await page.click('#spousesDropdown .combo-option:has-text("Blair Existing")');
  await page.waitForTimeout(150);
  const stillOpenDuringConfirm = await page.getAttribute('#spousesDropdown', 'hidden');
  const confirmVisible = await page.evaluate(() => !document.getElementById('spousesConfirm').hidden);
  console.log('dropdown hidden during confirm (expect null/open):', stillOpenDuringConfirm, 'confirm visible:', confirmVisible);
  if (stillOpenDuringConfirm !== null) throw new Error('Expected the dropdown to stay open for the current/former confirm');
  if (!confirmVisible) throw new Error('Expected the current/former confirm panel to be showing');

  await page.click('#spousesConfirmCurrent');
  await page.waitForTimeout(150);
  const spousesDropdownHiddenAfterConfirm = await page.getAttribute('#spousesDropdown', 'hidden');
  const spouseChips = await page.evaluate(() => Array.from(document.querySelectorAll('#spousesChips .chip-name')).map(n => n.textContent));
  console.log('dropdown hidden after confirm:', spousesDropdownHiddenAfterConfirm, 'chips:', JSON.stringify(spouseChips));
  if (spousesDropdownHiddenAfterConfirm === null) throw new Error('Expected the spouses dropdown to close once the confirm resolves');
  if (!spouseChips.includes('Blair Existing')) throw new Error('Expected the picked spouse to appear as a chip');
  console.log('Confirmed: the spouse confirm still works, and the dropdown closes once it resolves.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
