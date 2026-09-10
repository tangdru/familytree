import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}

const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, 'Boston, USA'));
['n1', 'n2'].forEach((id, i) => add(person(id, `Near${i}`, 1970 + [1, -3][i], 'Chicago, USA')));
['f1', 'f2', 'f3'].forEach((id, i) => add(person(id, `Far${i}`, 1970 + [25, -28, 22][i], 'Paris, France')));
add(person('lonepeak', 'Peak Farthest', 1930, 'Tokyo, Japan')); // way out, biggest single contributor to radius

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

  const readTransform = () => page.evaluate(() => {
    const t = document.getElementById('treeCanvas').style.transform;
    const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), scale: parseFloat(m[3]) } : null;
  });

  // The grid's own origin point can legitimately move in content space
  // when the ring layout resizes (recentering or switching metric changes
  // ring membership/radii) -- animateCentricPan corrects view.x/y for
  // exactly that shift, so raw translate() is NOT expected to stay
  // byte-identical. What must stay constant is the SCALE (no rescale) and
  // the grid's own visual anchor: the center card's on-screen position.
  const readCenterScreenPos = () => page.evaluate(() => {
    const el = document.querySelector('.centric-center-card');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  const contentFits = async () => {
    const contentBox = await page.evaluate(() => document.getElementById('treeContent').getBoundingClientRect());
    const vpBox = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
    const pad = 26; // fitToView's own 24px padding, +2px float slop
    return contentBox.left >= vpBox.left - pad && contentBox.right <= vpBox.right + pad &&
      contentBox.top >= vpBox.top - pad && contentBox.bottom <= vpBox.bottom + pad;
  };

  console.log('=== Pan/zoom away, then enter Centric view: should reframe to fit (entry only) ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 400, viewport.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);

  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  if (!(await contentFits())) throw new Error('Expected centric content to fit the viewport right after entering the view');
  console.log('Confirmed: entering Centric view reframes to fit.');

  console.log("\n=== Once inside, recentering does NOT re-fit -- the user's own pan/zoom is preserved ===");
  // Zoom in hard and pan off-target first, so a genuine re-fit would be obvious.
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(150);
  const beforeRecenterScale = (await readTransform()).scale;
  const beforeRecenterPos = await readCenterScreenPos();
  await page.click('[data-id="lonepeak"]');
  await page.waitForTimeout(700);
  const afterRecenterScale = (await readTransform()).scale;
  const afterRecenterPos = await readCenterScreenPos();
  const isCenterLonepeak = await page.evaluate(() => document.querySelector('.centric-center-card').dataset.id);
  if (isCenterLonepeak !== 'lonepeak') throw new Error('Expected recentering to succeed before checking the transform');
  if (Math.abs(afterRecenterScale - beforeRecenterScale) > 0.001) {
    throw new Error(`Expected recentering to leave zoom scale untouched, was ${beforeRecenterScale} now ${afterRecenterScale}`);
  }
  if (Math.abs(afterRecenterPos.x - beforeRecenterPos.x) > 6 || Math.abs(afterRecenterPos.y - beforeRecenterPos.y) > 6) {
    throw new Error(`Expected the grid's origin to stay at the same screen position after recentering, was ${JSON.stringify(beforeRecenterPos)} now ${JSON.stringify(afterRecenterPos)}`);
  }
  console.log("Confirmed: recentering preserves the user's own zoom and keeps the grid's origin visually anchored (no auto-refit, no drift).");

  console.log('\n=== Switching the Age/Location metric also does NOT re-fit, and does not drift ===');
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
  const beforeMetricScale = (await readTransform()).scale;
  const beforeMetricPos = await readCenterScreenPos();
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const afterMetricScale = (await readTransform()).scale;
  const afterMetricPos = await readCenterScreenPos();
  if (Math.abs(afterMetricScale - beforeMetricScale) > 0.001) {
    throw new Error(`Expected switching metric to leave zoom scale untouched, was ${beforeMetricScale} now ${afterMetricScale}`);
  }
  if (Math.abs(afterMetricPos.x - beforeMetricPos.x) > 6 || Math.abs(afterMetricPos.y - beforeMetricPos.y) > 6) {
    throw new Error(`Expected the grid's origin to stay at the same screen position after switching metric, was ${JSON.stringify(beforeMetricPos)} now ${JSON.stringify(afterMetricPos)}`);
  }
  console.log("Confirmed: switching metric preserves the user's own zoom and keeps the grid's origin visually anchored (no auto-refit, no drift).");

  console.log('\n=== Leaving and re-entering Centric view fits again (fresh entry) ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(700);
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 350, viewport.y + 250, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  if (!(await contentFits())) throw new Error('Expected re-entering centric view (after leaving) to reframe to fit again');
  console.log('Confirmed: leaving and re-entering Centric view reframes again, as a fresh entry.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
