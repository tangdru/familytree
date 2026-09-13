import { chromium } from 'playwright-core';

function person(id, name, year, opts = {}) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: opts.parents || [], spouses: opts.spouses || [], locations: [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('a', 'Alice A', 1970));
add(person('b', 'Bob B', 1972));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  // The auto-popup tour is gated behind !navigator.webdriver so it never
  // fires during automated testing -- override it here since this test
  // specifically exercises the auto-show-on-first-visit behavior a real
  // (non-automated) visitor would see.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  // The tour is Driver.js (see startTour() in app.js): it marks the tour
  // active/inactive via a `driver-active` class on <body>, rather than a
  // hidden attribute on an app-owned overlay element.
  const isTourActive = () => page.evaluate(() => document.body.classList.contains('driver-active'));
  const progressText = () => page.evaluate(() => document.querySelector('.driver-popover-progress-text')?.textContent || '');
  // Driver.js's step transition (position/content update) lands ~150-200ms
  // after the click resolves -- polling for actual change instead of a
  // fixed sleep avoids flakiness right at that boundary.
  async function clickNextAndWait(prevProgress) {
    await page.click('.driver-popover-next-btn');
    await page.waitForFunction(
      (prev) => document.querySelector('.driver-popover-progress-text')?.textContent !== prev
        || !document.body.classList.contains('driver-active'),
      prevProgress,
      { timeout: 5000 },
    );
  }

  console.log('=== First visit: tour auto-starts ===');
  await page.waitForTimeout(900);
  if (!(await isTourActive())) throw new Error('Expected the tour to auto-show on first visit');
  const firstStepText = await page.evaluate(() => document.querySelector('.driver-popover-description')?.textContent || '');
  if (!firstStepText.toLowerCase().includes('add')) {
    throw new Error(`Expected first tour step to mention adding a person, got: "${firstStepText}"`);
  }
  console.log('Confirmed: tour auto-shows on first visit, step 1 =', JSON.stringify(firstStepText));

  console.log('\n=== Stepping through the whole tour via Next ===');
  let steps = 1;
  while (true) {
    const progress = await progressText();
    const [cur, , total] = progress.split(' ');
    await clickNextAndWait(progress);
    steps++;
    if (cur === total) break;
    if (steps > 20) throw new Error('Tour did not terminate after 20 Next clicks');
  }
  if (await isTourActive()) throw new Error('Expected the tour to end after clicking through to Done');
  const seenFlag = await page.evaluate(() => localStorage.getItem('familytree.tourSeen.v1'));
  if (seenFlag !== '1') throw new Error('Expected the tour-seen flag to be set after completing the tour');
  console.log('Confirmed: tour completes via repeated Next clicks and sets the seen flag.');

  console.log('\n=== Reload: tour does NOT auto-show again ===');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (await isTourActive()) throw new Error('Expected the tour NOT to auto-show again after being marked seen');
  console.log('Confirmed: tour stays hidden on subsequent visits.');

  console.log('\n=== Help modal opens from the toolbar "?" button ===');
  await page.click('#helpBtn');
  await page.waitForTimeout(150);
  const helpHidden = await page.evaluate(() => document.getElementById('helpModal').hidden);
  if (helpHidden) throw new Error('Expected the Help modal to open on clicking #helpBtn');
  const sectionCount = await page.evaluate(() => document.querySelectorAll('.help-section').length);
  if (sectionCount < 5) throw new Error(`Expected several help sections, found ${sectionCount}`);
  console.log('Confirmed: Help modal opens with', sectionCount, 'sections.');

  console.log('\n=== Replay walkthrough from Help modal ===');
  await page.click('#replayTourBtn');
  await page.waitForTimeout(150);
  const helpHiddenAfterReplay = await page.evaluate(() => document.getElementById('helpModal').hidden);
  if (!helpHiddenAfterReplay) throw new Error('Expected Help modal to close when replaying the walkthrough');
  if (!(await isTourActive())) throw new Error('Expected the tour to reopen after clicking Replay walkthrough');
  console.log('Confirmed: Replay walkthrough closes Help and reopens the tour.');

  console.log('\n=== Skip (relabeled close button) ends the tour immediately ===');
  const skipLabel = await page.evaluate(() => document.querySelector('.driver-popover-close-btn')?.textContent || '');
  if (skipLabel !== 'Skip') throw new Error(`Expected the close button to read "Skip", got "${skipLabel}"`);
  await page.click('.driver-popover-close-btn');
  await page.waitForTimeout(150);
  if (await isTourActive()) throw new Error('Expected Skip to end the tour');
  console.log('Confirmed: Skip is labeled and ends the tour.');

  console.log('\n=== Highlight tracks the target element (add person button) ===');
  await page.click('#helpBtn');
  await page.click('#replayTourBtn');
  await page.waitForTimeout(200);
  const isActiveElement = await page.evaluate(() => document.getElementById('addPersonBtn').classList.contains('driver-active-element'));
  if (!isActiveElement) throw new Error('Expected #addPersonBtn to be marked as the current step\'s active element');
  console.log('Confirmed: highlight tracks the current step\'s target element.');

  console.log('\n=== Popover stays fully within the viewport ===');
  const popoverRect = await page.evaluate(() => document.querySelector('.driver-popover').getBoundingClientRect());
  if (popoverRect.left < 0 || popoverRect.top < 0 || popoverRect.right > 900 || popoverRect.bottom > 700) {
    throw new Error(`Popover out of viewport bounds: ${JSON.stringify(popoverRect)}`);
  }
  console.log('Confirmed: popover stays within viewport bounds.');

  console.log('\n=== Skip is hidden on the last step ===');
  while (true) {
    const progress = await progressText();
    const [cur, , total] = progress.split(' ');
    if (cur === total) break;
    await clickNextAndWait(progress);
  }
  const closeBtnVisibleOnLast = await page.evaluate(() => {
    const btn = document.querySelector('.driver-popover-close-btn');
    return !!btn && getComputedStyle(btn).display !== 'none';
  });
  if (closeBtnVisibleOnLast) throw new Error('Expected Skip (close) to be hidden on the last tour step');
  console.log('Confirmed: Skip hidden on the last step.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
