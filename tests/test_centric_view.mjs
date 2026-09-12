import { chromium } from 'playwright-core';

// A: center candidate, born 1970, lives in Boston.
// B: age diff 2 (ring 1); ~190mi from Boston -> location ring 2 (50-500mi).
// C: age diff 12 (ring 2); ~3mi from Boston -> location ring 1 (0-50mi).
// D: age diff 25 (ring 3); ~3,450mi from Boston -> location ring 4 (3,000+mi).
// E: no birthdate, no location -> ring 4 (age) / ring 5 "Unknown distance" (location).
// Real coordinates so the Location metric exercises the actual haversine
// distance calculation (see haversineDistanceKm/centricLocationRing).
const A = 'A', B = 'B', C = 'C', D = 'D', E = 'E';
const loc = (text, lat, lon) => [{ text, lat, lon }];
const people = {
  [A]: { id: A, name: 'Alice Center', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: loc('Boston, Massachusetts', 42.3601, -71.0589) },
  [B]: { id: B, name: 'Bob Near', birthDate: '1972-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: loc('New York, New York', 40.7128, -74.0060) },
  [C]: { id: C, name: 'Carol Mid', birthDate: '1982-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: loc('Cambridge, Massachusetts', 42.3736, -71.1097) },
  [D]: { id: D, name: 'Dave Far', birthDate: '1995-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: loc('Paris, France', 48.8566, 2.3522) },
  [E]: { id: E, name: 'Eve Unknown', birthDate: '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Switch to Centric View: default center is the first person, toggle appears ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(500);
  const toggleVisible = await page.evaluate(() => getComputedStyle(document.getElementById('centricMetricToggle')).opacity);
  if (parseFloat(toggleVisible) < 0.9) throw new Error(`Expected the Age/Location toggle to be visible in Centric view, opacity was ${toggleVisible}`);
  const initialCenter = await page.evaluate(() => document.querySelector('.centric-center-card').dataset.id);
  if (initialCenter !== A) throw new Error(`Expected the default center to be the first person (${A}), got ${initialCenter}`);
  console.log('Confirmed: metric toggle is visible and Alice (first person) is the default center.');

  console.log('\n=== Click a non-center card (Bob) to recenter, then click Alice (now non-center) to recenter back ===');
  await page.click(`[data-id="${B}"]`);
  await page.waitForTimeout(500);
  const isCenterB = await page.evaluate((id) => document.querySelector(`[data-id="${id}"]`).classList.contains('centric-center-card'), B);
  if (!isCenterB) throw new Error('Expected Bob to become the center card after clicking him');
  await page.click(`[data-id="${A}"]`);
  await page.waitForTimeout(500);
  const isCenterA = await page.evaluate((id) => document.querySelector(`[data-id="${id}"]`).classList.contains('centric-center-card'), A);
  if (!isCenterA) throw new Error('Expected Alice to become the center card again after clicking her while she was not centered');
  console.log('Confirmed: clicking a non-center card recenters on it, back and forth.');

  const readPositions = () => page.evaluate(() => {
    const rect = (id) => {
      const el = document.querySelector(`[data-id="${id}"]`);
      return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    };
    return { A: rect('A'), B: rect('B'), C: rect('C'), D: rect('D'), E: rect('E') };
  });

  const dist = (p1, p2) => Math.hypot(
    (p1.left + p1.width / 2) - (p2.left + p2.width / 2),
    (p1.top + p1.height / 2) - (p2.top + p2.height / 2)
  );

  console.log('\n=== Age metric: ring distance from center increases with age difference ===');
  let pos = await readPositions();
  const dB = dist(pos.A, pos.B); // age diff 2 -> ring 1
  const dC = dist(pos.A, pos.C); // age diff 12 -> ring 2
  const dD = dist(pos.A, pos.D); // age diff 25 -> ring 3
  const dE = dist(pos.A, pos.E); // no birthdate -> ring 4 (furthest)
  console.log(`distances from center -- B:${dB.toFixed(0)} C:${dC.toFixed(0)} D:${dD.toFixed(0)} E:${dE.toFixed(0)}`);
  if (!(dB < dC && dC < dD && dD < dE)) {
    throw new Error(`Expected strictly increasing distance B < C < D < E by age proximity, got B:${dB} C:${dC} D:${dD} E:${dE}`);
  }
  console.log('Confirmed: age-proximity rings order correctly.');

  console.log('\n=== No connector lines drawn in Centric view (only the concentric grid) ===');
  // The SVG now legitimately holds the concentric grid (circles + axis
  // labels, see test_single_card_and_grid.mjs) -- what should never appear
  // here is a parent/child or spouse connector, which drawLines() always
  // draws as <path>/<line> elements.
  const connectorCount = await page.evaluate(() => document.querySelectorAll('#linesSvg > path, #linesSvg > line').length);
  if (connectorCount !== 0) throw new Error(`Expected zero connector lines in centric view, found ${connectorCount}`);
  console.log('Confirmed: no connector lines (grid circles/labels aside).');

  console.log('\n=== Switch to Location metric: Carol (nearest, ~3mi) becomes closest ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(500);
  const activeBtn = await page.evaluate(() => document.querySelector('.centric-metric-btn.active').dataset.metric);
  if (activeBtn !== 'location') throw new Error('Expected the Location button to become active');
  pos = await readPositions();
  const dC2 = dist(pos.A, pos.C); // ~3mi -> ring 1 (0-50mi)
  const dB2 = dist(pos.A, pos.B); // ~190mi -> ring 2 (50-500mi)
  const dD2 = dist(pos.A, pos.D); // ~3,450mi -> ring 4 (3,000+mi)
  const dE2 = dist(pos.A, pos.E); // no location -> ring 5 (unknown distance), farthest of all
  console.log(`distances from center by location -- B:${dB2.toFixed(0)} C:${dC2.toFixed(0)} D:${dD2.toFixed(0)} E:${dE2.toFixed(0)}`);
  if (!(dC2 < dB2 && dB2 < dD2 && dD2 < dE2)) {
    throw new Error(`Expected Carol (~3mi) closest, then Bob (~190mi), then Dave (~3,450mi), then Eve (unknown distance) farthest. Got C:${dC2} B:${dB2} D:${dD2} E:${dE2}`);
  }
  console.log('Confirmed: real-distance rings order correctly, Carol is now closest and Eve (no location) is farthest.');

  console.log('\n=== Clicking the already-centered card (Alice) opens her modal instead of re-centering ===');
  await page.click(`[data-id="${A}"]`);
  await page.waitForTimeout(300);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (modalHidden) throw new Error('Expected clicking the already-centered card to open the Person View modal');
  const modalName = await page.evaluate(() => document.getElementById('viewName').textContent);
  if (!modalName.includes('Alice')) throw new Error(`Expected the modal to show Alice, got "${modalName}"`);
  console.log('Confirmed: clicking the center card opens its modal.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Clicking a non-center card (Dave) recenters instead of opening a modal ===');
  await page.click(`[data-id="${D}"]`);
  await page.waitForTimeout(500);
  const isCenterD = await page.evaluate((id) => document.querySelector(`[data-id="${id}"]`).classList.contains('centric-center-card'), D);
  const modalHiddenAfterRecenter = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (!isCenterD) throw new Error('Expected Dave to become the new center after clicking him');
  if (!modalHiddenAfterRecenter) throw new Error('Expected no modal to open when recentering on a non-center card');
  console.log('Confirmed: clicking a non-center card recenters without opening a modal.');

  console.log('\n=== Toggle hides when leaving Centric view ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(300);
  const toggleOpacityAfter = await page.evaluate(() => getComputedStyle(document.getElementById('centricMetricToggle')).opacity);
  if (parseFloat(toggleOpacityAfter) > 0.1) throw new Error(`Expected the toggle to fade out, opacity was ${toggleOpacityAfter}`);
  console.log('Confirmed: toggle hides outside Centric view.');

  console.log('\n=== Center persists across view switches (Dave stays center on returning) ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(500);
  const isCenterDAgain = await page.evaluate((id) => document.querySelector(`[data-id="${id}"]`).classList.contains('centric-center-card'), D);
  if (!isCenterDAgain) throw new Error('Expected Dave to remain the center after switching away and back');
  console.log('Confirmed: centric center persists across view switches.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
