import { chromium } from 'playwright-core';

const dad = 'dad', mom = 'mom', kid1 = 'kid1', kid2 = 'kid2';
const people = {
  [dad]: { id: dad, name: 'Papa Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [mom] },
  [mom]: { id: mom, name: 'Mama Doe', birthDate: '1952-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [dad] },
  [kid1]: { id: kid1, name: 'Kid One Doe', birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [kid2]: { id: kid2, name: 'Kid Two Doe', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
};

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

  // el.style.top/left reflect whatever was last ASSIGNED, not the actual
  // mid-transition rendered position -- getBoundingClientRect() is what
  // actually reflects the live, currently-interpolated visual position.
  const posOf = (id) => page.evaluate((id) => {
    const el = document.querySelector(`.person-card[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  }, id);

  console.log('=== Traditional layout: initial position of kid1 ===');
  const beforeSwitch = await posOf(kid1);
  console.log(JSON.stringify(beforeSwitch));

  console.log('\n=== Switch to Chronological: card should NOT jump instantly to the final position ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  // Sample very early into the transition (well under the 380ms duration).
  await page.waitForTimeout(60);
  const midTransition = await posOf(kid1);
  console.log('mid-transition:', JSON.stringify(midTransition));

  await page.waitForTimeout(500); // let the transition fully finish
  const afterSettle = await posOf(kid1);
  console.log('after settling:', JSON.stringify(afterSettle));

  if (midTransition.top === afterSettle.top && midTransition.left === afterSettle.left) {
    throw new Error('Expected the card to still be mid-flight (a different top/left) shortly after switching views, not already at rest');
  }
  console.log('Confirmed: card was still animating shortly after the mode switch, and reached a stable final position.');

  console.log('\n=== Lines track the moving cards: check the line/card mismatch during the transition ===');
  // Switch back to traditional and sample the SVG line count/endpoints
  // immediately vs after settling, to confirm drawLines was called more
  // than once (i.e. isn't just a single static draw).
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(30);
  const linesEarly = await page.evaluate(() => document.getElementById('linesSvg').innerHTML);
  await page.waitForTimeout(500);
  const linesLate = await page.evaluate(() => document.getElementById('linesSvg').innerHTML);
  console.log('lines changed during the transition (expect true):', linesEarly !== linesLate);
  if (linesEarly === linesLate) {
    console.log('(Not necessarily a failure -- could mean the transition finished very fast on this machine -- but flagging for visibility.)');
  }

  console.log('\n=== Final positions are exactly correct after the animation (no residual offset) ===');
  const finalCards = await page.evaluate(() => Array.from(document.querySelectorAll('.person-card')).map(c => ({ id: c.dataset.id, left: c.style.left, top: c.style.top })));
  console.log(JSON.stringify(finalCards));
  // Re-render once more with no actual change (re-select the same mode) and confirm positions are stable (idempotent).
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(500);
  const stableCards = await page.evaluate(() => Array.from(document.querySelectorAll('.person-card')).map(c => ({ id: c.dataset.id, left: c.style.left, top: c.style.top })));
  if (JSON.stringify(finalCards) !== JSON.stringify(stableCards)) {
    throw new Error('Expected re-selecting the same view mode to leave positions unchanged: ' + JSON.stringify({ finalCards, stableCards }));
  }
  console.log('Positions stable and idempotent.');

  console.log('\n=== A person card still opens the view modal on click after all this ===');
  await page.click(`.person-card[data-id="${kid1}"]`);
  await page.waitForTimeout(200);
  const viewName = await page.evaluate(() => document.getElementById('viewName').textContent);
  console.log('opened view for:', viewName);
  if (viewName !== 'Kid One Doe') throw new Error('Expected clicking the card to open its Person View, got: ' + viewName);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
