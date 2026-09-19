import { chromium } from 'playwright-core';

// The first-time walkthrough (Driver.js, see TOUR_STEPS in app.js) now
// demonstrates Traditional, Chronological, and Centric view modes by
// actually switching #viewModeSelect's value as each step's onNextClick
// fires, rather than only naming them in one static description. Confirms
// each step both lands on the right element AND leaves the app in the view
// mode that step is about, and that leaving the Centric step returns to
// Traditional (so the person-card step right after it still gets a plain
// tap-to-open, not a Centric recenter).
function person(id, name, year, opts = {}) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: opts.parents || [], spouses: opts.spouses || [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('a', 'Alice A', 1970));
add(person('b', 'Bob B', 1998, { parents: ['a'] }));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const viewMode = () => page.evaluate(() => document.getElementById('viewModeSelect').value);
  const popoverText = () => page.evaluate(() => document.querySelector('.driver-popover-description')?.textContent || '');

  console.log('=== Start the tour, advance to the viewModeSelect intro step ===');
  await page.click('#helpBtn');
  await page.waitForTimeout(200);
  await page.click('#replayTourBtn');
  await page.waitForTimeout(300);
  await page.click('.driver-popover-next-btn'); // addPersonBtn -> viewModeSelect
  await page.waitForTimeout(250);
  const introText = await popoverText();
  if (!introText.includes('Traditional') || !introText.includes('Zodiac')) {
    throw new Error(`Expected the viewModeSelect intro step naming all 4 views, got: ${introText}`);
  }
  console.log('Confirmed: intro step still names all 4 views.');

  console.log('\n=== Advancing to Traditional switches (and stays on) Traditional ===');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(300);
  if ((await viewMode()) !== 'traditional') throw new Error(`Expected viewMode 'traditional', got: ${await viewMode()}`);
  const tradText = await popoverText();
  if (!tradText.includes('Traditional Tree')) throw new Error(`Expected the Traditional step's description, got: ${tradText}`);
  console.log('Confirmed: Traditional step targets #treeViewport with viewMode set to traditional.');

  console.log('\n=== Advancing to Chronological switches to it and shows the ruler ===');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(300);
  if ((await viewMode()) !== 'chronological') throw new Error(`Expected viewMode 'chronological', got: ${await viewMode()}`);
  const chronoText = await popoverText();
  if (!chronoText.includes('Chronological Tree')) throw new Error(`Expected the Chronological step's description, got: ${chronoText}`);
  const rulerVisible = await page.evaluate(() => document.getElementById('chronoRuler').classList.contains('visible'));
  if (!rulerVisible) throw new Error('Expected the chrono ruler to be visible once switched to Chronological');
  console.log('Confirmed: Chronological step targets the ruler with viewMode set to chronological.');

  console.log('\n=== Advancing to Centric switches to it and shows the metric toggle ===');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(400);
  if ((await viewMode()) !== 'centric') throw new Error(`Expected viewMode 'centric', got: ${await viewMode()}`);
  const centricText = await popoverText();
  if (!centricText.includes('Centric View')) throw new Error(`Expected the Centric step's description, got: ${centricText}`);
  const toggleVisible = await page.evaluate(() => document.getElementById('centricMetricToggle').classList.contains('visible'));
  if (!toggleVisible) throw new Error('Expected the Age/Location metric toggle to be visible once switched to Centric');
  console.log('Confirmed: Centric step targets the metric toggle with viewMode set to centric.');

  console.log('\n=== Leaving Centric forward returns to Traditional ===');
  await page.click('.driver-popover-next-btn'); // -> searchToggleBtn
  await page.waitForTimeout(300);
  if ((await viewMode()) !== 'traditional') throw new Error(`Expected viewMode back to 'traditional' after leaving Centric, got: ${await viewMode()}`);
  console.log('Confirmed: leaving the Centric step resets viewMode to traditional.');

  console.log('\n=== The person-card step right after still opens the card on a plain tap ===');
  await page.click('.driver-popover-next-btn'); // -> person-card
  await page.waitForTimeout(250);
  await page.click('.driver-popover-next-btn'); // opens the card, -> addStoryBtn
  await page.waitForTimeout(400);
  const viewModalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (viewModalHidden) throw new Error('Expected the Person View to open normally after the view-mode demo steps reset to Traditional');
  console.log('Confirmed: the tour still flows correctly into the person-card/Stories steps.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
