import { chromium } from 'playwright-core';

// Regression test for a real bug: switching away from Globe View to another
// view mode (e.g. Traditional) right as a pending Globe render frame is
// in flight left stray .map-card/.map-cluster elements floating over the
// new view -- see the screenshot report. Root cause: renderGlobeFrame() is
// reached from several different animation loops (scheduleGlobeRender's
// one-shot requestAnimationFrame, and animateGlobeTo's own step loop)
// that, unlike startGlobeAutoSpin/startGlobeInertia/startGlobeSpinUp, don't
// keep a cancelable handle and don't self-check viewMode -- so a frame
// queued right before the view-mode switch still fires one tick later and
// unconditionally re-appends fresh globe markers into #treeContent, right
// after the new view's own render just finished populating it. Fixed by a
// `if (viewMode !== 'globe') return;` guard at the top of renderGlobeFrame.
const p1 = 'p1', p2 = 'p2';
const people = {
  [p1]: {
    id: p1, name: 'Ana Cruz', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Boston, Massachusetts', lat: 42.3601, lon: -71.0589 },
  },
  [p2]: {
    id: p2, name: 'Tom Doe', birthDate: '1990-06-15', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'New York, USA', lat: 40.7128, lon: -74.006 },
  },
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

  console.log('=== Enter Globe View and let it settle ===');
  await page.selectOption('#viewModeSelect', 'globe');
  await page.waitForTimeout(900); // first load: vendored d3/topojson/world-atlas fetch
  const markersOnEntry = await page.evaluate(() => document.querySelectorAll('.map-card, .map-cluster').length);
  if (markersOnEntry === 0) throw new Error('Expected at least one globe marker on entry, found none');
  console.log(`Confirmed: ${markersOnEntry} globe marker(s) present.`);

  console.log('\n=== Queue a globe render frame (wheel-zoom) then switch to Traditional in the SAME tick ===');
  // Both dispatched synchronously inside one evaluate() call: the wheel
  // event queues a pending scheduleGlobeRender() frame via
  // requestAnimationFrame, then the immediately-following view switch
  // synchronously tears down and rebuilds #treeContent for Traditional --
  // all before the browser ever gets a chance to run that queued frame.
  await page.evaluate(() => {
    document.getElementById('treeViewport').dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
    );
    document.getElementById('viewModeSelect').value = 'traditional';
    document.getElementById('viewModeSelect').dispatchEvent(new Event('change'));
  });
  // Give the previously-queued stale frame (and any others) a chance to
  // fire before checking -- this is exactly the window the bug lived in.
  await page.waitForTimeout(300);

  const leakedMarkers = await page.evaluate(() => document.querySelectorAll('.map-card, .map-cluster').length);
  if (leakedMarkers !== 0) {
    throw new Error(`Expected zero leftover .map-card/.map-cluster elements after switching away from Globe View, found ${leakedMarkers}`);
  }
  console.log('Confirmed: no stray globe markers leaked into Traditional view.');

  const viewModeNow = await page.evaluate(() => document.getElementById('viewModeSelect').value);
  if (viewModeNow !== 'traditional') throw new Error(`Expected to have actually switched to traditional, got "${viewModeNow}"`);
  const traditionalCardCount = await page.evaluate(() => document.querySelectorAll('#treeContent .person-card').length);
  if (traditionalCardCount !== 2) throw new Error(`Expected the 2 real person cards to still render in Traditional view, got ${traditionalCardCount}`);
  console.log('Confirmed: Traditional view itself still rendered correctly (2 real person cards).');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
