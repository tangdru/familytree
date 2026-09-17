import { chromium } from 'playwright-core';

// Two related layout bugs reported from a real phone: (1) the Add/Edit
// form's footer (Save/Cancel/Delete) used to live INSIDE #personForm --
// the same scrollable box a parents/spouses combo dropdown opens into --
// and had its own opaque background + higher z-index specifically so it
// would stay clickable by painting OVER that dropdown when the two
// happened to overlap; visually, that meant the footer bar could cut
// straight through the middle of the dropdown's own option list. (2) the
// on-screen keyboard opening (typing into the combo's filter field, or
// any text field) could leave the Save button pushed past the visible
// area. The fix: the footer is now a sibling of #personForm, pinned
// outside its scrollable box entirely (a dropdown can only ever overflow
// WITHIN that box now, never past it into the footer's space) -- and the
// modal's max-height now also has a dvh fallback (iOS 15.4+) alongside
// the static vh, so it shrinks with the keyboard instead of assuming a
// stale, pre-keyboard viewport height. dvh's specific effect isn't
// something a Chromium-based headless run can reproduce (the underlying
// bug is a Safari-only quirk where vh ignores the on-screen keyboard) --
// this test covers the structural half: the footer and dropdown can no
// longer occupy the same visual space at all, by construction.
const others = {};
for (let i = 0; i < 12; i++) {
  others[`o${i}`] = { id: `o${i}`, name: `Person Number ${i}`, birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] };
}
const p1 = 'p1';
const people = { [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] }, ...others };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // Short viewport, same spirit as the reported phone screenshots -- the
  // whole point is there's not much vertical room to begin with.
  const page = await browser.newPage({ viewport: { width: 400, height: 650 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Open Jane\'s edit card, open the parents combo dropdown ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(200);
  const dropdownHidden = await page.getAttribute('#parentsDropdown', 'hidden');
  if (dropdownHidden !== null) throw new Error('Expected the parents dropdown to be open');

  const rects = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    return {
      dropdown: r(document.getElementById('parentsDropdown')),
      footer: r(document.querySelector('#personModal .modal-footer')),
      form: r(document.getElementById('personForm')),
      modal: r(document.querySelector('#personModal .modal')),
    };
  });
  console.log(JSON.stringify(rects));

  console.log('\n=== Nothing from the dropdown paints where the footer sits ===');
  // The dropdown's own (unclipped) layout box can still geometrically
  // extend past #personForm's bottom edge -- getBoundingClientRect()
  // reports the box, not what's actually painted -- but #personForm's
  // overflow-y:auto clips (and un-hit-tests) anything past that edge, so
  // nothing from it should ever actually render, or be clickable, at the
  // footer's own position. elementFromPoint checks what's really there.
  const footerMidY = (rects.footer.top + rects.footer.bottom) / 2;
  const paintedAtFooter = await page.evaluate((y) => {
    const el = document.elementFromPoint(200, y);
    return { tag: el?.tagName, isComboOption: !!el?.closest('.combo-option'), isFooter: !!el?.closest('#personModal .modal-footer') };
  }, footerMidY);
  console.log(JSON.stringify(paintedAtFooter));
  if (paintedAtFooter.isComboOption) throw new Error(`Expected nothing from the dropdown to paint at the footer's position, got: ${JSON.stringify(paintedAtFooter)}`);
  if (!paintedAtFooter.isFooter) throw new Error(`Expected the footer itself to be what's actually there, got: ${JSON.stringify(paintedAtFooter)}`);
  console.log('Confirmed: the footer paints cleanly, with no dropdown content bleeding through.');

  console.log('\n=== The footer sits below #personForm, not inside its scrollable box ===');
  if (rects.footer.top < rects.form.bottom - 1) {
    throw new Error(`Expected the footer to start at/after #personForm's own bottom edge, got footer.top=${rects.footer.top} form.bottom=${rects.form.bottom}`);
  }
  console.log('Confirmed: the footer is a sibling below the form, not nested inside it.');

  console.log('\n=== The footer (and its Save button) stays fully within the visible modal ===');
  if (rects.footer.bottom > rects.modal.bottom + 1) {
    throw new Error(`Expected the footer to fit within the modal's own box, got footer.bottom=${rects.footer.bottom} modal.bottom=${rects.modal.bottom}`);
  }
  const saveVisible = await page.locator('button[type="submit"][form="personForm"]').isVisible();
  if (!saveVisible) throw new Error('Expected the Save button to be visible');
  console.log('Confirmed: Save is visible and inside the modal\'s own bounds.');

  console.log('\n=== Save (now outside <form>, tied via form="personForm") still actually saves ===');
  await page.click('#closeModalBtn'); // dropdown open state isn't needed for this part
  await page.waitForTimeout(150);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    document.getElementById('nameInput').textContent = 'Footer Save Check';
    document.getElementById('nameInput').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('button[type="submit"][form="personForm"]');
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => Array.from(document.querySelectorAll('.person-name')).some(el => el.textContent === 'Footer Save Check'));
  if (!saved) throw new Error('Expected clicking the externalized Save button to still submit the form and create the person');
  console.log('Confirmed: Save, now living outside <form id="personForm">, still submits it correctly.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
