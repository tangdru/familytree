import { chromium } from 'playwright-core';

// #personForm doubles as the Add/Edit modal's own scrollable .modal-body,
// reused (not recreated) across opens -- so without an explicit reset,
// reopening it after a previous session left it scrolled down (a long
// form: several locations, contacts, parents/spouses) would still show
// wherever that earlier scroll left off, not the top of the form. Covers
// openModalForAdd and openModalForEdit, which between them cover every
// entry point: a plain Add Person, editing an existing person (single or
// from a couple card -- same #personForm either way), and the nested
// "+ Add new spouse"/"+ Add new parent" sub-flows (both call
// openModalForAdd internally).
const p1 = 'p1', p2 = 'p2';
const people = {
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '',
    parents: [], spouses: [p2], spouseStatus: {},
    locations: [
      { text: 'Boston, MA', startDate: '2010', endDate: '2015' },
      { text: 'Seattle, WA', startDate: '2015', endDate: '2020' },
      { text: 'Denver, CO', startDate: '2020', endDate: '' },
    ],
    contacts: ['617-555-0114', 'jane.doe@gmail.com', 'Loves hiking.'],
  },
  [p2]: { id: p2, name: 'John Doe', birthDate: '1983-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // Short viewport so the form (name/dates/locations x3/contacts x3/
  // parents/spouses) reliably overflows and actually needs to scroll.
  const page = await browser.newPage({ viewport: { width: 420, height: 620 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const formScrollTop = () => page.evaluate(() => document.getElementById('personForm').scrollTop);
  const scrollFormDown = () => page.evaluate(() => { document.getElementById('personForm').scrollTop = 300; });

  console.log('=== Open Jane\'s edit card (a couple -- she has a spouse), scroll it down ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await scrollFormDown();
  const scrolledDown = await formScrollTop();
  console.log('scrollTop after manually scrolling down:', scrolledDown);
  if (scrolledDown === 0) throw new Error('Test setup failed: the form did not actually scroll (not tall enough to overflow?)');

  console.log('\n=== Cancel out, reopen the SAME edit card -- should be back at the top ===');
  await page.click('#closeModalBtn'); // cancels straight back to the bare tree (viewEditBtn already closed the Person View on the way in)
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(150);
  const reopenedScrollTop = await formScrollTop();
  console.log('scrollTop on reopening edit:', reopenedScrollTop);
  if (reopenedScrollTop !== 0) throw new Error(`Expected reopening the edit card to reset scroll to the top, got scrollTop ${reopenedScrollTop}`);
  console.log('Confirmed: reopening edit resets to the top of the form.');

  console.log('\n=== Scroll down again, then trigger the nested "+ Add new spouse" flow -- also starts at the top ===');
  await scrollFormDown();
  if ((await formScrollTop()) === 0) throw new Error('Test setup failed: could not re-scroll the form');
  await page.click('#spousesCombo .combo-trigger');
  await page.waitForTimeout(150);
  await page.click('.combo-option-create');
  await page.waitForTimeout(200);
  const nestedTitle = await page.textContent('#modalTitle');
  console.log('nested modal title (expect Add Spouse):', nestedTitle);
  if (nestedTitle !== 'Add Spouse') throw new Error('Expected the nested "+ Add new spouse" form to have opened');
  const nestedScrollTop = await formScrollTop();
  console.log('scrollTop on the nested Add Spouse form:', nestedScrollTop);
  if (nestedScrollTop !== 0) throw new Error(`Expected the nested Add Spouse form to start at the top, got scrollTop ${nestedScrollTop}`);
  console.log('Confirmed: the nested add-spouse sub-form also starts at the top.');

  console.log('\n=== Cancel everything, open a plain Add Person -- also starts at the top ===');
  await page.click('#closeModalBtn'); // cancel nested -> restores outer edit
  await page.waitForTimeout(150);
  await page.click('#closeModalBtn'); // cancel outer edit entirely
  await page.waitForTimeout(150);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(150);
  const addScrollTop = await formScrollTop();
  console.log('scrollTop on a plain Add Person:', addScrollTop);
  if (addScrollTop !== 0) throw new Error(`Expected a plain Add Person to start at the top, got scrollTop ${addScrollTop}`);
  console.log('Confirmed: a plain Add Person also starts at the top.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
