import { chromium } from 'playwright-core';

// Two more combo-dropdown bugs reported from a real phone: (1) the filter
// input's own left padding was silently getting overridden back down to
// 10px by .form-row input[type=text] (an attribute selector, so higher
// specificity than plain .combo-filter) -- exactly where the search icon
// sits, so the icon visibly overlapped whatever was typed. (2) opening the
// dropdown scrolls it into view immediately (see
// test_combo_dropdown_scroll_and_close.mjs), but tapping into the filter
// input to actually type raises the on-screen keyboard afterward, as a
// separate event -- the keyboard shrinking the visible viewport could push
// an already-correctly-positioned dropdown back out of view. Both fixed:
// an ID-scoped override restores the padding, and a visualViewport resize
// listener re-runs the scroll-into-view while the dropdown is open.
const p1 = 'p1';
const people = { [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 650 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== The filter input\'s left padding leaves room for the icon (no overlap) ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(200);
  const paddingLeft = await page.evaluate(() => getComputedStyle(document.querySelector('#parentsDropdown .combo-filter')).paddingLeft);
  console.log('computed padding-left:', paddingLeft);
  if (paddingLeft !== '32px') throw new Error(`Expected the filter input's left padding to stay 32px (room for the icon), got ${paddingLeft}`);
  const rects = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    return { icon: r(document.querySelector('#parentsDropdown .combo-filter-icon')), input: r(document.querySelector('#parentsDropdown .combo-filter')) };
  });
  console.log(JSON.stringify(rects));
  const textStartX = rects.input.left + parseFloat(paddingLeft);
  if (textStartX < rects.icon.right) throw new Error(`Expected typed text to start (${textStartX}) after the icon's right edge (${rects.icon.right}) -- they'd overlap`);
  console.log('Confirmed: the icon and typed text no longer overlap.');

  console.log('\n=== The dropdown re-scrolls into view when the keyboard opens (visualViewport resize) ===');
  // Simulate the keyboard shoving the dropdown out of view: scroll the
  // form so the dropdown's top is now above the visible area, same as
  // what a real keyboard-open resize would otherwise cause.
  await page.evaluate(() => { document.getElementById('personForm').scrollTop = 0; });
  const beforeResize = await page.evaluate(() => document.getElementById('parentsDropdown').getBoundingClientRect().top);
  await page.evaluate(() => { document.getElementById('personForm').scrollTop += 200; });
  const pushedOutOfView = await page.evaluate(() => {
    const d = document.getElementById('parentsDropdown').getBoundingClientRect();
    const f = document.getElementById('personForm').getBoundingClientRect();
    return d.bottom > f.bottom + 1 || d.top < f.top - 1;
  });
  console.log('dropdown top before:', beforeResize, 'pushed out of view by manual scroll:', pushedOutOfView);
  if (!pushedOutOfView) throw new Error('Test setup failed: expected the manual scroll to actually push the dropdown out of view');

  // Same synthetic-event approach as test_search_keyboard_scroll.mjs --
  // headless Chromium won't raise a real keyboard, but dispatching the
  // event visualViewport fires when one opens/closes exercises the same
  // listener a real keyboard resize would trigger.
  await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(150);
  const backInView = await page.evaluate(() => {
    const d = document.getElementById('parentsDropdown').getBoundingClientRect();
    const f = document.getElementById('personForm').getBoundingClientRect();
    return d.bottom <= f.bottom + 1 && d.top >= f.top - 1;
  });
  console.log('back in view after visualViewport resize:', backInView);
  if (!backInView) throw new Error('Expected the visualViewport resize to re-scroll the dropdown back into view');
  console.log('Confirmed: a visualViewport resize while the dropdown is open re-scrolls it into view.');

  console.log('\n=== Once closed, a visualViewport resize is a no-op (doesn\'t reopen/rescroll it) ===');
  await page.click('#closeModalBtn');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(100);
  if (errors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(errors)}`);
  console.log('Confirmed: no errors from a resize event while everything is closed.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
