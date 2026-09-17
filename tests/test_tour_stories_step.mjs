import { chromium } from 'playwright-core';

// The first-time walkthrough (Driver.js, see TOUR_STEPS in app.js) now
// includes a step pointing at the Stories "+ Add story" button -- unlike
// every other step, that element only exists once a Person View card is
// actually open, so the person-card step's onNextClick opens one before
// advancing, and the Stories step's onDeselected closes it again on the
// way out. (The tour only ever shows Next/Close buttons -- see
// showButtons on the driver config -- so there's no backward navigation
// to worry about.) Note: Driver.js leaves its own `driver-active-element`
// CSS class on every previously-highlighted element in this version
// rather than removing it (a pre-existing quirk, reproducible even on the
// original 4-step tour) -- so these checks use the popover's own
// position/text instead of that class as the signal for "what's actually
// highlighted right now".
const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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

  console.log('=== Start the tour via Replay walkthrough, advance to the person-card step ===');
  await page.click('#helpBtn');
  await page.waitForTimeout(200);
  await page.click('#replayTourBtn');
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) {
    await page.click('.driver-popover-next-btn');
    await page.waitForTimeout(250);
  }
  const personCardText = await page.evaluate(() => document.querySelector('.driver-popover-description')?.textContent);
  if (!personCardText.includes('full profile')) throw new Error(`Expected to be on the person-card step, got: ${personCardText}`);

  console.log('\n=== Advancing past person-card opens the view card and targets #addStoryBtn ===');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(400);
  const onStories = await page.evaluate(() => {
    const popover = document.querySelector('.driver-popover')?.getBoundingClientRect();
    const addStoryBtn = document.getElementById('addStoryBtn')?.getBoundingClientRect();
    return {
      viewModalHidden: document.getElementById('personViewModal').hidden,
      popoverText: document.querySelector('.driver-popover-description')?.textContent,
      // The popover sits just below its target (stagePadding + popoverOffset,
      // ~16px here) -- a reliable, class-independent way to confirm it's
      // actually anchored to #addStoryBtn and not some earlier element.
      popoverJustBelowAddStoryBtn: addStoryBtn && popover && Math.abs(popover.top - addStoryBtn.bottom) < 30,
    };
  });
  console.log(JSON.stringify(onStories));
  if (onStories.viewModalHidden) throw new Error('Expected the Person View to be open on the Stories tour step');
  if (!onStories.popoverText.includes('Stories')) throw new Error(`Expected the Stories step's description, got: ${onStories.popoverText}`);
  if (!onStories.popoverJustBelowAddStoryBtn) throw new Error('Expected the popover to be positioned right at #addStoryBtn');
  console.log('Confirmed: Stories step opens the view card and targets #addStoryBtn.');

  console.log('\n=== Advancing past Stories closes the view card again, landing on Fit-to-view ===');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(400);
  const afterFit = await page.evaluate(() => ({
    viewModalHidden: document.getElementById('personViewModal').hidden,
    popoverText: document.querySelector('.driver-popover-description')?.textContent,
  }));
  console.log(JSON.stringify(afterFit));
  if (!afterFit.viewModalHidden) throw new Error('Expected the Person View to close after leaving the Stories step');
  if (!afterFit.popoverText.includes('Fit to view') && !afterFit.popoverText.includes('fit everyone')) {
    throw new Error(`Expected the Fit-to-view step, got: ${afterFit.popoverText}`);
  }
  console.log('Confirmed: leaving Stories forward closes the view card.');

  console.log('\n=== No Previous button anywhere -- the tour is forward-only (Next/Close) ===');
  const prevVisible = await page.locator('.driver-popover-prev-btn').isVisible().catch(() => false);
  if (prevVisible) throw new Error('Expected no visible Previous button -- the tour config only shows Next/Close');
  console.log('Confirmed: no backward navigation to worry about.');

  console.log('\n=== Finishing the tour from here closes everything cleanly ===');
  await page.click('.driver-popover-next-btn'); // -> helpBtn
  await page.waitForTimeout(250);
  await page.click('.driver-popover-next-btn'); // Done
  await page.waitForTimeout(250);
  const finalState = await page.evaluate(() => ({
    tourGone: !document.querySelector('.driver-popover'),
    viewModalHidden: document.getElementById('personViewModal').hidden,
  }));
  console.log(JSON.stringify(finalState));
  if (!finalState.tourGone) throw new Error('Expected the tour to be fully closed');
  if (!finalState.viewModalHidden) throw new Error('Expected the view card to stay closed once the tour ends');
  console.log('Confirmed: tour completes cleanly.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
