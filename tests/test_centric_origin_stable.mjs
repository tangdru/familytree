import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}

const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, 'Boston, USA'));
// Lots of people crammed into ONE age ring (so the Age ring's radius stays
// small/nominal) but spread across every location ring, forcing Location's
// ring layout (and therefore maxRadius/origin) to be quite different in
// size from Age's -- this is exactly the kind of asymmetry that would
// reveal the origin drifting when switching metrics.
for (let i = 0; i < 14; i++) {
  add(person(`n${i}`, `Near${i}`, 1970 + (i % 3) - 1, i % 2 === 0 ? 'Boston, USA' : (i % 3 === 0 ? 'Chicago, USA' : 'Paris, France')));
}

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

  const readCenterScreenPos = () => page.evaluate(() => {
    const el = document.querySelector('.centric-center-card');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  const beforeSwitch = await readCenterScreenPos();
  console.log('center screen position on Age:', JSON.stringify(beforeSwitch));

  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const afterSwitch = await readCenterScreenPos();
  console.log('center screen position on Location:', JSON.stringify(afterSwitch));

  const dx = Math.abs(afterSwitch.x - beforeSwitch.x);
  const dy = Math.abs(afterSwitch.y - beforeSwitch.y);
  console.log('drift:', dx.toFixed(2), dy.toFixed(2));
  if (dx > 2 || dy > 2) {
    throw new Error(`Expected the center card's on-screen position to stay put when switching metric, drifted by (${dx.toFixed(2)}, ${dy.toFixed(2)})`);
  }
  console.log('Confirmed: center stays visually anchored across a metric switch.');

  console.log('\n=== Also check recentering onto someone else keeps the origin anchored ===');
  const beforeRecenter = await readCenterScreenPos();
  await page.click('[data-id="n0"]');
  await page.waitForTimeout(700);
  const afterRecenter = await page.evaluate(() => {
    const el = document.querySelector('.centric-center-card');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  console.log('before recenter (old center):', JSON.stringify(beforeRecenter), 'after recenter (new center):', JSON.stringify(afterRecenter));
  const dx2 = Math.abs(afterRecenter.x - beforeRecenter.x);
  const dy2 = Math.abs(afterRecenter.y - beforeRecenter.y);
  console.log('drift on recenter:', dx2.toFixed(2), dy2.toFixed(2));
  if (dx2 > 2 || dy2 > 2) {
    throw new Error(`Expected the grid's origin point to stay at the same screen position after recentering (only WHO occupies the middle changes), drifted by (${dx2.toFixed(2)}, ${dy2.toFixed(2)})`);
  }
  console.log('Confirmed: origin point stays visually anchored across a recenter too.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
