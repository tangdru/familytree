import { chromium } from 'playwright-core';

// The root-cause fix, not another bandage: iOS Safari doesn't reliably
// resize/reposition `position: fixed` elements against the keyboard-
// shrunk VISUAL viewport -- a fixed element's box can keep being computed
// against the full, pre-keyboard LAYOUT viewport instead. Neither the
// modal's own max-height: 90dvh nor a manual scrollIntoView on the open
// dropdown (see test_combo_dropdown_scroll_and_close.mjs and
// test_combo_filter_keyboard_reflow.mjs) can help if the modal's own OUTER
// box was never actually resized/repositioned in the first place --
// fitModalOverlaysToVisualViewport() pins every open .modal-overlay
// directly to visualViewport's real, current offset/size in JS, so
// whatever's actually visible above the keyboard becomes the modal's real
// box. A real page.setViewportSize() shrink (not a synthetic event with
// no real dimension change) is what actually exercises this.
const p1 = 'p1';
const others = {};
for (let i = 0; i < 6; i++) {
  others[`o${i}`] = { id: `o${i}`, name: `Candidate ${i}`, birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] };
}
const people = { [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] }, ...others };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Open edit + the parents dropdown at full height ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#parentsCombo .combo-trigger');
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => {
    const overlay = document.getElementById('personModal');
    return { inlineHeight: overlay.style.height, vvHeight: window.visualViewport.height };
  });
  console.log('before shrink:', JSON.stringify(before));
  if (before.inlineHeight !== `${before.vvHeight}px`) {
    throw new Error(`Expected the overlay to already be pinned to the visual viewport's height on open, got ${before.inlineHeight} vs ${before.vvHeight}px`);
  }

  console.log('\n=== Shrink the real viewport (stand-in for the keyboard opening) ===');
  await page.setViewportSize({ width: 400, height: 420 });
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => {
    const overlay = document.getElementById('personModal');
    const modalRect = document.querySelector('#personModal .modal').getBoundingClientRect();
    const dropdownRect = document.getElementById('parentsDropdown').getBoundingClientRect();
    return {
      inlineHeight: overlay.style.height,
      vvHeight: window.visualViewport.height,
      modalBottom: modalRect.bottom,
      dropdownBottom: dropdownRect.bottom,
    };
  });
  console.log('after shrink:', JSON.stringify(after));
  if (after.inlineHeight !== `${after.vvHeight}px`) {
    throw new Error(`Expected the overlay's pinned height to track the shrunk visual viewport, got ${after.inlineHeight} vs ${after.vvHeight}px`);
  }
  if (after.modalBottom > after.vvHeight + 1) {
    throw new Error(`Expected the modal itself to fit within the shrunk viewport (${after.vvHeight}px), got its bottom at ${after.modalBottom}`);
  }
  if (after.dropdownBottom > after.vvHeight + 1) {
    throw new Error(`Expected the still-open dropdown to also fit within the shrunk viewport (${after.vvHeight}px), got its bottom at ${after.dropdownBottom}`);
  }
  console.log('Confirmed: the modal (and the dropdown inside it) actually shrink to fit the real available space, not just the pre-shrink layout.');

  console.log('\n=== Growing back restores the full-size pin ===');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(250);
  const restored = await page.evaluate(() => ({
    inlineHeight: document.getElementById('personModal').style.height,
    vvHeight: window.visualViewport.height,
  }));
  console.log(JSON.stringify(restored));
  if (restored.inlineHeight !== `${restored.vvHeight}px`) throw new Error('Expected the overlay to track the viewport growing back too');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
