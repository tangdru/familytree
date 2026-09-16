import { chromium } from 'playwright-core';

// Contact chips used to show a masked/trimmed bit of the actual number or
// address next to their icon (see the old contactChipLabel) -- now they're
// icon-only buttons, and a phone number gets both a Call and a Text
// action (tel:/sms:) instead of just one, since the two go to different
// apps even though they share the same number.
const p1 = 'p1', p2 = 'p2';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], contacts: ['617-555-0114', 'jane.doe@gmail.com'] },
  // Free text that isn't a phone or email -- shouldn't silently vanish.
  [p2]: { id: p2, name: 'Notes Guy', birthDate: '1991-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], contacts: ['Loves hiking.'] },
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

  console.log('=== A phone number gets Call + Text; an email gets Email -- all icon-only ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(300);

  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#viewContact .contact-chip')).map(c => ({
    href: c.getAttribute('href'),
    title: c.getAttribute('title'),
    ariaLabel: c.getAttribute('aria-label'),
    text: c.textContent.trim(),
  })));
  console.log(JSON.stringify(chips));

  if (chips.length !== 3) throw new Error(`Expected 3 action buttons (Call+Text for the phone, Email for the address), got ${chips.length}`);
  if (chips.some(c => c.text !== '')) throw new Error('Expected every button to be icon-only with no visible label text');

  const call = chips.find(c => c.href && c.href.startsWith('tel:'));
  const text = chips.find(c => c.href && c.href.startsWith('sms:'));
  const email = chips.find(c => c.href && c.href.startsWith('mailto:'));
  if (!call) throw new Error('Expected a tel: Call action for the phone number');
  if (!text) throw new Error('Expected an sms: Text action for the phone number');
  if (!email) throw new Error('Expected a mailto: Email action for the address');
  if (call.href !== text.href.replace('sms:', 'tel:')) throw new Error('Expected Call and Text to target the same underlying number');
  console.log('Confirmed: exactly one Call, one Text, and one Email action, none showing visible text.');

  console.log('\n=== The full value is still reachable via title/aria-label, even though nothing is shown on the card ===');
  if (!call.title.includes('617-555-0114') || !call.ariaLabel.includes('617-555-0114')) {
    throw new Error(`Expected the phone number in Call's title/aria-label, got: ${JSON.stringify(call)}`);
  }
  if (!text.title.includes('617-555-0114') || !text.ariaLabel.includes('617-555-0114')) {
    throw new Error(`Expected the phone number in Text's title/aria-label, got: ${JSON.stringify(text)}`);
  }
  if (!email.title.includes('jane.doe@gmail.com') || !email.ariaLabel.includes('jane.doe@gmail.com')) {
    throw new Error(`Expected the email address in Email's title/aria-label, got: ${JSON.stringify(email)}`);
  }
  if (call.title.toLowerCase().includes('call') === false) throw new Error('Expected the Call button\'s title to name the action, not just the number');
  if (text.title.toLowerCase().includes('text') === false) throw new Error('Expected the Text button\'s title to name the action, not just the number');
  console.log('Confirmed: hovering/inspecting each icon still reveals the real number/address and which action it performs.');

  console.log('\n=== A contact value that isn\'t a phone or email still shows up, as an inert icon ===');
  await page.click('#viewCloseBtn');
  await page.click('.person-card:has-text("Notes Guy")');
  await page.waitForTimeout(300);
  const freeTextChip = await page.evaluate(() => {
    const c = document.querySelector('#viewContact .contact-chip');
    return c ? { tag: c.tagName, href: c.getAttribute('href'), title: c.getAttribute('title'), text: c.textContent.trim() } : null;
  });
  console.log(JSON.stringify(freeTextChip));
  if (!freeTextChip) throw new Error('Expected an unrecognized contact value to still render a chip instead of disappearing');
  if (freeTextChip.tag !== 'SPAN') throw new Error(`Expected a non-clickable <span> (no tel:/sms:/mailto: target to offer), got a <${freeTextChip.tag}>`);
  if (freeTextChip.href) throw new Error('Expected no href on an inert chip');
  if (freeTextChip.title !== 'Loves hiking.') throw new Error(`Expected the raw value in the title, got: ${freeTextChip.title}`);
  console.log('Confirmed: unrecognized contact text still shows (inertly) instead of silently vanishing.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
