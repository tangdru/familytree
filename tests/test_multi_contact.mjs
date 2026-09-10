import { chromium } from 'playwright-core';

const p1 = 'p1';
const legacy = 'legacy';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [legacy]: { id: legacy, name: 'Old Contact Person', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', contact: '617-555-0000', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Add Person: fresh modal starts with exactly one empty contact row ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  let rows = await page.$$('.contact-row-input');
  console.log('fresh row count:', rows.length);
  if (rows.length !== 1) throw new Error('Expected exactly one empty contact row on Add Person');
  await page.click('#cancelBtn');
  await page.waitForTimeout(150);

  console.log('\n=== Jane: add two contacts (phone + email), save, view card shows both as links ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const firstInput = await page.$('.contact-row-input');
  await firstInput.click();
  await page.keyboard.type('6175551234');
  await page.waitForTimeout(100);

  await page.click('#addContactBtn');
  await page.waitForTimeout(100);
  let inputs = await page.$$('.contact-row-input');
  console.log('row count after +Add contact:', inputs.length);
  if (inputs.length !== 2) throw new Error('Expected a second empty row after clicking +Add contact');
  await inputs[1].click();
  await page.keyboard.type('jane');
  await page.waitForTimeout(100);
  const gmailBtnVisible = await page.evaluate(() => {
    const rows = document.querySelectorAll('.contact-row');
    const secondBtn = rows[1].querySelector('.contact-gmail-btn');
    return !secondBtn.hidden;
  });
  console.log('second row gmail button visible:', gmailBtnVisible);
  if (!gmailBtnVisible) throw new Error('Expected the second row\'s own gmail button to appear');
  await page.evaluate(() => document.querySelectorAll('.contact-row')[1].querySelector('.contact-gmail-btn').click());
  await page.waitForTimeout(100);
  const secondValue = await page.evaluate(() => document.querySelectorAll('.contact-row-input')[1].textContent);
  console.log('second row value after gmail click:', secondValue);
  if (secondValue !== 'jane@gmail.com') throw new Error('Expected jane@gmail.com, got: ' + secondValue);

  // First row's gmail button should NOT have appeared (it's a phone).
  const firstGmailHidden = await page.evaluate(() => document.querySelectorAll('.contact-row')[0].querySelector('.contact-gmail-btn').hidden);
  console.log('first row gmail button still hidden (phone row, expect true):', firstGmailHidden);
  if (!firstGmailHidden) throw new Error('Expected the first (phone) row\'s gmail button to stay hidden');

  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1.contacts);
  console.log('saved contacts:', JSON.stringify(saved));
  if (JSON.stringify(saved) !== JSON.stringify(['617-555-1234', 'jane@gmail.com'])) {
    throw new Error('Expected both contacts saved in order, got: ' + JSON.stringify(saved));
  }

  const viewLines = await page.evaluate(() => Array.from(document.querySelectorAll('#viewContact .contact-chip')).map(el => {
    return { title: el.getAttribute('title'), href: el.getAttribute('href') };
  }));
  console.log('view card contact chips:', JSON.stringify(viewLines));
  if (viewLines.length !== 2) throw new Error('Expected two contact chips on the view card');
  if (viewLines[0].href !== 'tel:6175551234') throw new Error('Expected first chip to be a tel: link, got: ' + viewLines[0].href);
  if (viewLines[0].title !== '617-555-1234') throw new Error('Expected first chip title to be the full number, got: ' + viewLines[0].title);
  if (viewLines[1].href !== 'mailto:jane@gmail.com') throw new Error('Expected second chip to be a mailto: link, got: ' + viewLines[1].href);

  console.log('\n=== Remove the first contact row in the edit form, save, confirm only the email remains ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('.contact-row-remove >> nth=0');
  await page.waitForTimeout(100);
  const remaining = await page.evaluate(() => Array.from(document.querySelectorAll('.contact-row-input')).map(el => el.textContent));
  console.log('rows after removing the first:', JSON.stringify(remaining));
  if (JSON.stringify(remaining) !== JSON.stringify(['jane@gmail.com'])) throw new Error('Expected only the email row to remain');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  const savedAfterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1.contacts);
  console.log('saved contacts after removal:', JSON.stringify(savedAfterRemove));
  if (JSON.stringify(savedAfterRemove) !== JSON.stringify(['jane@gmail.com'])) throw new Error('Expected only the email to remain saved');

  console.log('\n=== Legacy person (old singular `contact` field): preloads into the Contact(s) list, view card shows it ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Old Contact Person")');
  await page.waitForTimeout(200);
  const legacyViewLines = await page.evaluate(() => Array.from(document.querySelectorAll('#viewContact .contact-chip')).map(el => el.getAttribute('title')));
  console.log('legacy view card contact chips:', JSON.stringify(legacyViewLines));
  if (JSON.stringify(legacyViewLines) !== JSON.stringify(['617-555-0000'])) throw new Error('Expected the legacy contact to show on the view card');

  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const legacyRows = await page.evaluate(() => Array.from(document.querySelectorAll('.contact-row-input')).map(el => el.textContent));
  console.log('legacy edit-form rows:', JSON.stringify(legacyRows));
  if (JSON.stringify(legacyRows) !== JSON.stringify(['617-555-0000'])) throw new Error('Expected the legacy contact preloaded into the list');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
