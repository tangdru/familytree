import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  console.log('=== Typing digits live-formats with dashes as a phone number ===');
  await page.click('.contact-row-input');
  await page.keyboard.type('6175551234');
  await page.waitForTimeout(100);
  let value = await page.$eval('.contact-row-input', el => el.textContent);
  console.log('contact value after typing 10 digits:', value);
  if (value !== '617-555-1234') throw new Error('Expected the phone number to be grouped as 617-555-1234, got: ' + value);

  let gmailHidden = await page.getAttribute('.contact-gmail-btn', 'hidden');
  console.log('gmail button hidden for phone mode (expect non-null):', gmailHidden);
  if (gmailHidden === null) throw new Error('Expected the +@gmail.com button to stay hidden in phone mode');

  console.log('\n=== Inserting a digit in the middle keeps the caret in the right spot ===');
  // Move caret to right after "617-" (position 4 in "617-555-1234") and type "9".
  await page.evaluate(() => {
    const el = document.querySelector('.contact-row-input');
    const textNode = el.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.type('9');
  await page.waitForTimeout(100);
  value = await page.$eval('.contact-row-input', el => el.textContent);
  console.log('value after inserting 9 right after "617-":', value);
  if (value !== '617-955-5123-4'.replace('617-955-5123-4', value) ) {} // placeholder, real check below
  // Digits are now 6175591551234 -> wait let's just recompute expected directly.
  const expectedDigits = '617' + '9' + '5551234';
  console.log('expected raw digit sequence:', expectedDigits, '(11 digits -> grouped with country-code style)');
  if (value.replace(/\D/g, '') !== expectedDigits) throw new Error('Expected digits ' + expectedDigits + ', got ' + value.replace(/\D/g, ''));
  const caretDigitsBefore = await page.evaluate(() => {
    const el = document.querySelector('.contact-row-input');
    const sel = window.getSelection();
    const offset = sel.getRangeAt(0).startOffset;
    return (el.textContent.slice(0, offset).match(/\d/g) || []).length;
  });
  console.log('digits before caret after the insert (expect 4 -- right after the just-typed 9):', caretDigitsBefore);
  if (caretDigitsBefore !== 4) throw new Error('Expected the caret to sit right after the newly typed digit (4 digits before it), got ' + caretDigitsBefore);

  console.log('\n=== Clear and type letters: the +@gmail.com button should appear ===');
  await page.click('.contact-row-input');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('jane');
  await page.waitForTimeout(100);
  value = await page.$eval('.contact-row-input', el => el.textContent);
  console.log('value after typing letters:', value);
  if (value !== 'jane') throw new Error('Expected plain text "jane" with no reformatting, got: ' + value);
  gmailHidden = await page.getAttribute('.contact-gmail-btn', 'hidden');
  console.log('gmail button hidden (expect null -- should be visible):', gmailHidden);
  if (gmailHidden !== null) throw new Error('Expected the +@gmail.com button to appear once letters are typed');

  console.log('\n=== Clicking +@gmail.com appends the domain and hides the button again ===');
  await page.click('.contact-gmail-btn');
  await page.waitForTimeout(100);
  value = await page.$eval('.contact-row-input', el => el.textContent);
  console.log('value after clicking +@gmail.com:', value);
  if (value !== 'jane@gmail.com') throw new Error('Expected jane@gmail.com, got: ' + value);
  gmailHidden = await page.getAttribute('.contact-gmail-btn', 'hidden');
  console.log('gmail button hidden after appending (expect non-null):', gmailHidden);
  if (gmailHidden === null) throw new Error('Expected the button to hide again once an @ is present');

  console.log('\n=== Save persists the email, and the view card shows it as a mailto: link ===');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1.contacts[0]);
  console.log('saved contact:', saved);
  if (saved !== 'jane@gmail.com') throw new Error('Expected saved contact to be jane@gmail.com');

  const viewState = await page.evaluate(() => {
    const el = document.getElementById('viewContact');
    const a = el.querySelector('a.contact-chip');
    return { hidden: el.hidden, title: a ? a.getAttribute('title') : null, href: a ? a.getAttribute('href') : null };
  });
  console.log('view card contact chip:', JSON.stringify(viewState));
  if (viewState.hidden) throw new Error('Expected the view card to show the contact chip');
  if (viewState.href !== 'mailto:jane@gmail.com') throw new Error('Expected a mailto: link, got: ' + viewState.href);
  if (viewState.title !== 'jane@gmail.com') throw new Error('Expected the chip title to hold the full email, got: ' + viewState.title);

  console.log('\n=== Editing back to a phone number and saving shows a tel: link ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('.contact-row-input');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('4155551212');
  await page.waitForTimeout(100);
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(200);
  const viewState2 = await page.evaluate(() => {
    const el = document.getElementById('viewContact');
    const a = el.querySelector('a.contact-chip');
    return { title: a ? a.getAttribute('title') : null, href: a ? a.getAttribute('href') : null };
  });
  console.log('view card contact chip (phone):', JSON.stringify(viewState2));
  if (viewState2.title !== '415-555-1212') throw new Error('Expected the chip title to hold the full formatted phone number, got: ' + viewState2.title);
  if (viewState2.href !== 'tel:4155551212') throw new Error('Expected a tel: link with plain digits, got: ' + viewState2.href);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
