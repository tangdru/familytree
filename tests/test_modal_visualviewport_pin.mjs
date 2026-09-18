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
    // NOT the dropdown's own getBoundingClientRect(): #parentsDropdown is
    // position:absolute inside #personForm's overflow-y:auto box, so its
    // OWN layout box can still geometrically extend past the fold even
    // though #personForm correctly clips (and un-hit-tests) anything past
    // its own edge -- the dropdown's raw rect isn't what's actually
    // painted or reachable. #personForm's own rect is the real clipping
    // container, so IT fitting is what actually matters.
    const formRect = document.getElementById('personForm').getBoundingClientRect();
    return {
      inlineHeight: overlay.style.height,
      vvHeight: window.visualViewport.height,
      modalBottom: modalRect.bottom,
      formBottom: formRect.bottom,
    };
  });
  console.log('after shrink:', JSON.stringify(after));
  if (after.inlineHeight !== `${after.vvHeight}px`) {
    throw new Error(`Expected the overlay's pinned height to track the shrunk visual viewport, got ${after.inlineHeight} vs ${after.vvHeight}px`);
  }
  if (after.modalBottom > after.vvHeight + 1) {
    throw new Error(`Expected the modal itself to fit within the shrunk viewport (${after.vvHeight}px), got its bottom at ${after.modalBottom}`);
  }
  if (after.formBottom > after.vvHeight + 1) {
    throw new Error(`Expected #personForm (the dropdown's real clipping container) to also fit within the shrunk viewport (${after.vvHeight}px), got its bottom at ${after.formBottom}`);
  }
  console.log('Confirmed: the modal, and the scrollable form the dropdown lives inside, actually shrink to fit the real available space, not just the pre-shrink layout.');

  console.log('\n=== The actual reported symptom: a search result becomes reachable by scrolling ===');
  await page.evaluate(() => { document.getElementById('personForm').scrollTop = document.getElementById('personForm').scrollHeight; });
  await page.waitForTimeout(100);
  const resultVisible = await page.evaluate(() => {
    const form = document.getElementById('personForm').getBoundingClientRect();
    const el = document.elementFromPoint(form.left + form.width / 2, form.bottom - 10);
    return { tag: el?.tagName, isComboOption: !!el?.closest('.combo-option') };
  });
  console.log(JSON.stringify(resultVisible));
  if (!resultVisible.isComboOption) throw new Error(`Expected a search result to actually be visible/reachable near the bottom of the shrunk, scrolled form, got: ${JSON.stringify(resultVisible)}`);
  console.log('Confirmed: a search result is genuinely reachable, not hidden behind the keyboard -- the actual reported bug.');

  console.log('\n=== Survives even if dvh itself is unreliable on the device ===');
  // Chromium's own dvh support happens to be solid, so the assertions
  // above would pass even without modal.style.maxHeight -- they don't by
  // themselves prove THIS fix is what's doing the work, only that
  // something is. Force the exact failure mode being fixed: a stylesheet
  // max-height that does NOT respond to the viewport shrinking at all
  // (standing in for a device where dvh silently doesn't track the
  // keyboard) and confirm the modal still ends up correctly capped.
  // Deliberately NOT !important -- app.js's own real max-height: 90dvh
  // isn't either, so this is the fair, realistic version of "dvh computed
  // something wrong": an inline style (what the fix actually sets) always
  // beats a plain external rule for the same property regardless of the
  // external rule's own specificity, so this proves the fix is what's
  // capping it, not a coincidence of Chromium's dvh being fine.
  await page.addStyleTag({ content: '#personModal .modal { max-height: 900px; }' });
  await page.waitForTimeout(150);
  const withBrokenDvh = await page.evaluate(() => {
    const modal = document.querySelector('#personModal .modal');
    return { computedMaxHeight: getComputedStyle(modal).maxHeight, inlineMaxHeight: modal.style.maxHeight, modalBottom: modal.getBoundingClientRect().bottom };
  });
  console.log(JSON.stringify(withBrokenDvh));
  if (withBrokenDvh.modalBottom > 420 + 1) {
    throw new Error(`Expected the modal to still fit the 420px-tall shrunk viewport even with a broken 900px !important max-height, got its bottom at ${withBrokenDvh.modalBottom}`);
  }
  console.log('Confirmed: an unreliable dvh value cannot break this -- the fix never depends on it.');

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
