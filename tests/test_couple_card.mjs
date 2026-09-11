import { chromium } from 'playwright-core';

// A three-generation family:
//   michael + susan (a couple) -> jane, tom
//   jane's own parents are michael (parent1) & susan (parent2)
//   michael's own parents: grandpa (alone, no recorded spouse for grandpa),
//   plus an older sibling (uncleBob) for the sibling-swipe check.
const people = {
  grandpa: { id: 'grandpa', name: 'Grandpa Doe', birthDate: '1930-01-01', deathDate: '', photo: '', notes: '', location: 'Boston', parents: [], spouses: [] },
  michael: { id: 'michael', name: 'Michael Doe', birthDate: '1959-01-01', deathDate: '', photo: '', notes: '', location: 'Chicago', parents: ['grandpa'], spouses: ['susan'] },
  susan: { id: 'susan', name: 'Susan Hart', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', location: 'Chicago', parents: [], spouses: ['michael'] },
  uncleBob: { id: 'uncleBob', name: 'Uncle Bob Doe', birthDate: '1957-01-01', deathDate: '', photo: '', notes: '', parents: ['grandpa'], spouses: [] },
  jane: { id: 'jane', name: 'Jane Doe', birthDate: '1985-01-01', deathDate: '', photo: '', notes: '', location: '', parents: ['michael', 'susan'], spouses: [] },
  tom: { id: 'tom', name: 'Tom Doe', birthDate: '1988-01-01', deathDate: '', photo: '', notes: '', parents: ['michael', 'susan'], spouses: [] },
};

// NOTE: uses real touch events (CDP Input.dispatchTouchEvent) rather than
// page.mouse -- a repeated mouse-drag + setPointerCapture cycle on the same
// element without an intervening re-render is a known Playwright/CDP
// synthetic-mouse quirk (confirmed by a standalone repro) that silently
// drops the gesture's later pointermove/pointerup events. Real users only
// ever hit this swipe zone via touch (`touch-action: none`), so touch is
// also the faithful way to test it here.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--touch-events=enabled'] });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 }, hasTouch: true });
  const cdp = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const state = () => page.evaluate(() => {
    const coupleHidden = document.getElementById('viewPhotoPair').hidden;
    const members = Array.from(document.querySelectorAll('#viewPhotoPair .view-photo-pair-member')).map(m => ({
      name: m.title,
      selected: m.classList.contains('selected'),
    }));
    return {
      mode: coupleHidden ? 'single' : 'couple',
      singleName: document.getElementById('viewName').textContent,
      members,
      meta: document.getElementById('viewMeta').textContent,
      siblings: Array.from(document.querySelectorAll('#viewSiblingsList .view-relation-link')).map(a => a.textContent),
      parents: Array.from(document.querySelectorAll('#viewParentsList .view-relation-link')).map(a => a.textContent),
      spousesHidden: document.getElementById('viewSpousesSection').hidden,
    };
  });
  const zoneCenter = () => page.evaluate(() => {
    const r = document.getElementById('viewSwipeZone').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  let touchId = 0;
  async function swipeDir(dx, dy) {
    const z = await zoneCenter();
    const id = ++touchId;
    const steps = 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: z.x, y: z.y, id }] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(15);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: z.x + dx * i / steps, y: z.y + dy * i / steps, id }] });
    }
    await page.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400); // outlasts the swipe's own settle-animation delay before it commits
  }
  async function tapMember(name) {
    await page.click(`#viewPhotoPair .view-photo-pair-member[title="${name}"]`);
    await page.waitForTimeout(150);
  }

  console.log('=== Open Jane, swipe down to parents ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  console.log('start:', JSON.stringify(await state()));

  await swipeDir(0, 150); // down -> parents
  let s = await state();
  console.log('after swipe down (expect couple: Michael selected, Susan not):', JSON.stringify(s));
  if (s.mode !== 'couple') throw new Error('Expected couple card after swiping down from a 2-parent child');
  if (!s.members.find(m => m.name === 'Michael Doe' && m.selected)) throw new Error('Expected Michael selected by default (Parent 1)');
  if (!s.members.find(m => m.name === 'Susan Hart' && !m.selected)) throw new Error('Expected Susan present, not selected');
  console.log('meta row (expect Chicago, Michael\'s own current location):', s.meta);
  if (!s.meta.includes('Chicago')) throw new Error('Expected Michael\'s own current location, Chicago, in the meta row');

  console.log('\n=== Tap Susan to switch selection ===');
  await tapMember('Susan Hart');
  s = await state();
  console.log('after tapping Susan:', JSON.stringify(s));
  if (!s.members.find(m => m.name === 'Susan Hart' && m.selected)) throw new Error('Expected Susan selected after tap');

  console.log('\n=== Swipe down again: Susan has no known parents -> no-op ===');
  await swipeDir(0, 150);
  s = await state();
  console.log('after swipe down again (expect still couple, Susan selected):', JSON.stringify(s));
  if (!s.members.find(m => m.name === 'Susan Hart' && m.selected)) throw new Error('Expected no-op, Susan still selected');

  console.log('\n=== Switch back to Michael, swipe down to grandpa ===');
  await tapMember('Michael Doe');
  await swipeDir(0, 150);
  s = await state();
  console.log('after swipe down from Michael (expect single card: Grandpa Doe, only 1 parent known):', JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Grandpa Doe') throw new Error('Expected single-card Grandpa Doe (only one parent recorded)');

  console.log('\n=== Swipe up: retrace back to Michael+Susan couple, Michael still selected ===');
  await swipeDir(0, -150);
  s = await state();
  console.log('after swipe up (expect couple, Michael selected -- remembered):', JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.find(m => m.name === 'Michael Doe' && m.selected)) throw new Error('Expected retrace to couple card with Michael selected');

  console.log('\n=== Swipe up again: back to origin child Jane ===');
  await swipeDir(0, -150);
  s = await state();
  console.log('after swipe up again (expect single: Jane Doe, the true origin):', JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Jane Doe') throw new Error('Expected to return to Jane');

  console.log('\n=== Sibling swipe from within a couple card ===');
  await swipeDir(0, 150); // back down to couple (Michael selected, remembered)
  s = await state();
  if (s.mode !== 'couple' || !s.members.find(m => m.name === 'Michael Doe' && m.selected)) throw new Error('Expected retrace couple, Michael selected');
  await swipeDir(150, 0); // right = older sibling of Michael -> Uncle Bob
  s = await state();
  console.log('after right-swipe from Michael in couple (expect fresh single card: Uncle Bob Doe):', JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Uncle Bob Doe') throw new Error('Expected sibling swipe to reset to single card of Uncle Bob');

  console.log('\n=== Parents-list link click extends thread into a couple card ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewParentsList .view-relation-link:has-text("Susan Hart")');
  await page.waitForTimeout(150);
  s = await state();
  console.log('after clicking Susan in Parents list (expect couple, Susan selected):', JSON.stringify(s));
  if (s.mode !== 'couple' || !s.members.find(m => m.name === 'Susan Hart' && m.selected)) throw new Error('Expected couple card with Susan selected via Parents link');
  console.log('spousesHidden (expect true):', s.spousesHidden);
  if (!s.spousesHidden) throw new Error('Expected Spouses section hidden in couple mode');

  console.log('\n=== Single-parent child stays single-card (no ambiguity to resolve) ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Uncle Bob Doe")');
  await page.waitForTimeout(200);
  await swipeDir(0, 150);
  s = await state();
  console.log('after swipe down from Uncle Bob (only 1 parent, expect single: Grandpa Doe):', JSON.stringify(s));
  if (s.mode !== 'single' || s.singleName !== 'Grandpa Doe') throw new Error('Expected single card for a single recorded parent');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
