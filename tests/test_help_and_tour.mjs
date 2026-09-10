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

  console.log('=== First visit: tour auto-starts ===');
  await page.waitForTimeout(900);
  const overlayHiddenAfterLoad = await page.evaluate(() => document.getElementById('tourOverlay').hidden);
  if (overlayHiddenAfterLoad) throw new Error('Expected the tour overlay to auto-show on first visit');
  const firstStepText = await page.evaluate(() => document.getElementById('tourTooltipText').textContent);
  if (!firstStepText.includes('Add Person') && !firstStepText.toLowerCase().includes('add')) {
    throw new Error(`Expected first tour step to mention adding a person, got: "${firstStepText}"`);
  }
  console.log('Confirmed: tour auto-shows on first visit, step 1 =', JSON.stringify(firstStepText));

  console.log('\n=== Stepping through the whole tour via Next ===');
  let steps = 1;
  while (true) {
    const progress = await page.evaluate(() => document.getElementById('tourProgress').textContent);
    const [cur, , total] = progress.split(' ');
    await page.click('#tourNextBtn');
    await page.waitForTimeout(150);
    steps++;
    if (cur === total) break;
    if (steps > 20) throw new Error('Tour did not terminate after 20 Next clicks');
  }
  const overlayHiddenAfterDone = await page.evaluate(() => document.getElementById('tourOverlay').hidden);
  if (!overlayHiddenAfterDone) throw new Error('Expected the tour overlay to hide after clicking through to Done');
  const seenFlag = await page.evaluate(() => localStorage.getItem('familytree.tourSeen.v1'));
  if (seenFlag !== '1') throw new Error('Expected the tour-seen flag to be set after completing the tour');
  console.log('Confirmed: tour completes via repeated Next clicks and sets the seen flag.');

  console.log('\n=== Reload: tour does NOT auto-show again ===');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const overlayHiddenOnReload = await page.evaluate(() => document.getElementById('tourOverlay').hidden);
  if (!overlayHiddenOnReload) throw new Error('Expected the tour NOT to auto-show again after being marked seen');
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
  const tourHiddenAfterReplay = await page.evaluate(() => document.getElementById('tourOverlay').hidden);
  if (!helpHiddenAfterReplay) throw new Error('Expected Help modal to close when replaying the walkthrough');
  if (tourHiddenAfterReplay) throw new Error('Expected the tour to reopen after clicking Replay walkthrough');
  console.log('Confirmed: Replay walkthrough closes Help and reopens the tour.');

  console.log('\n=== Skip button ends the tour immediately ===');
  await page.click('#tourSkipBtn');
  await page.waitForTimeout(150);
  const tourHiddenAfterSkip = await page.evaluate(() => document.getElementById('tourOverlay').hidden);
  if (!tourHiddenAfterSkip) throw new Error('Expected Skip to hide the tour overlay');
  console.log('Confirmed: Skip ends the tour.');

  console.log('\n=== Highlight tracks the target element (add person button) ===');
  await page.click('#helpBtn');
  await page.click('#replayTourBtn');
  await page.waitForTimeout(200);
  const addBtnRect = await page.evaluate(() => document.getElementById('addPersonBtn').getBoundingClientRect());
  const highlightRect = await page.evaluate(() => document.getElementById('tourHighlight').getBoundingClientRect());
  const centerDx = Math.abs((addBtnRect.left + addBtnRect.width / 2) - (highlightRect.left + highlightRect.width / 2));
  const centerDy = Math.abs((addBtnRect.top + addBtnRect.height / 2) - (highlightRect.top + highlightRect.height / 2));
  if (centerDx > 4 || centerDy > 4) {
    throw new Error(`Expected highlight to be centered on #addPersonBtn, dx=${centerDx} dy=${centerDy}`);
  }
  console.log('Confirmed: highlight box is centered on the current step\'s target element.');

  console.log('\n=== Tooltip stays fully within the viewport ===');
  const tooltipRect = await page.evaluate(() => document.getElementById('tourTooltip').getBoundingClientRect());
  if (tooltipRect.left < 0 || tooltipRect.top < 0 || tooltipRect.right > 900 || tooltipRect.bottom > 700) {
    throw new Error(`Tooltip out of viewport bounds: ${JSON.stringify(tooltipRect)}`);
  }
  console.log('Confirmed: tooltip stays within viewport bounds.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
