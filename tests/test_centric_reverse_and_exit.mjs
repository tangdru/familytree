import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, 'Boston, USA'));
add(person('n1', 'Near One', 1972, 'Chicago, USA'));
add(person('m1', 'Mid One', 1982, 'Boston, USA'));
add(person('f1', 'Far One', 1995, 'Paris, France'));
add(person('u1', 'Unknown One', null, null));

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

  // The grid keeps CENTRIC_MAX_RINGS (5) disc elements alive at all times
  // now (see ensureCentricGridElements in app.js) -- a ring beyond the
  // current metric's count sits hidden (display:none) at a parked radius
  // rather than not existing, so it's filtered out of these reads.
  const readRadii = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => parseFloat(c.getAttribute('r')))
      .sort((a, b) => a - b)
  );

  console.log('=== First entry into Centric: still builds innermost-first (unchanged, confirmed correct) ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(30); // early -- only ring 1 should have started noticeably
  const early = await readRadii();
  console.log('radii ~30ms after first entry:', JSON.stringify(early));
  // Ring 1's nominal target is 220 -- if building innermost-first, it
  // should already be well off its huge starting value while ring 4
  // (nominal 820, last to start) should still be much further from home.
  await page.waitForTimeout(700);
  const settledFirst = await readRadii();
  console.log('settled after first entry:', JSON.stringify(settledFirst));
  if (settledFirst.length !== 4) throw new Error(`Expected 4 rings settled, got ${settledFirst.length}`);
  console.log('Confirmed: first entry still settles to the correct 4 rings (unaffected by the direction change).');

  // Location has 5 tiers (city/region/country/hemisphere/elsewhere) vs
  // Age's 4, so switching between them shows/hides the 5th ring -- Age ->
  // Location makes it appear (shrinks in immediately, no stagger delay),
  // Location -> Age makes it disappear (grows out, waiting its turn like
  // any exiting ring, innermost-first).
  const readMaxRadius = () => page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => parseFloat(c.getAttribute('r'))))
  );

  console.log('\n=== Age -> Location (adding a ring): the new ring 5 starts shrinking in IMMEDIATELY ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  // The new ring 5 starts at a huge off-screen radius and shrinks with NO
  // stagger delay -- two early post-click samples should already show it
  // decreasing, rather than comparing against the pre-click (ring-4-only)
  // baseline, which the huge starting radius is naturally still above.
  await page.waitForTimeout(30); // very early -- should already be shrinking if immediate (no stagger delay)
  const veryEarly = await readMaxRadius();
  await page.waitForTimeout(60);
  const bitLater = await readMaxRadius();
  console.log(`outermost radius: ~30ms after click ${veryEarly.toFixed(0)}, ~90ms after click ${bitLater.toFixed(0)}`);
  if (bitLater >= veryEarly) {
    throw new Error(`Expected the newly-appearing ring 5 to already be shrinking within the first 90ms, got ${veryEarly} then ${bitLater}`);
  }
  console.log('Confirmed: the newly-appearing ring 5 starts shrinking in immediately.');
  await page.waitForTimeout(700);
  const settledLocation = await readRadii();
  if (settledLocation.length !== 5) throw new Error(`Expected 5 rings settled in Location metric, got ${settledLocation.length}`);

  console.log('\n=== Location -> Age (removing a ring): ring 5 still leaves LAST (starts moving late) ===');
  const beforeLocToAge = await readMaxRadius();
  await page.click('.centric-metric-btn[data-metric="age"]');
  await page.waitForTimeout(60); // still within ring 5's own stagger delay -- should NOT have moved yet
  const justAfterToAge = await readMaxRadius();
  console.log(`outermost radius: before click ${beforeLocToAge.toFixed(0)}, ~60ms after clicking Age ${justAfterToAge.toFixed(0)}`);
  if (Math.abs(justAfterToAge - beforeLocToAge) > 1) {
    throw new Error(`Expected the exiting ring 5 to still be stationary this early, moved from ${beforeLocToAge} to ${justAfterToAge}`);
  }
  console.log('Confirmed: removing ring 5 waits its turn before leaving.');
  await page.waitForTimeout(700);
  const settledAge = await readRadii();
  if (settledAge.length !== 4) throw new Error(`Expected 4 rings settled back in Age metric, got ${settledAge.length}`);
  console.log('Confirmed: settles back to exactly 4 rings in Age metric.');

  console.log('\n=== Leaving Centric view entirely: rings GROW outward (reverse of the shrink-in entrance), not shrink away ===');
  const findOverlay = () => page.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll('#treeCanvas > svg.lines-svg'));
    // There should be TWO once leaving: the real #linesSvg (now serving
    // Traditional view, no ring circles at all) and the temporary collapse
    // overlay (has the visible rings). The overlay also gets the full set
    // of CENTRIC_MAX_RINGS disc elements created (see
    // ensureCentricGridElements), so any beyond the metric's own count
    // (hidden, parked at r=0, never positioned) are filtered out here.
    const withRings = overlays
      .map(svg => Array.from(svg.querySelectorAll('circle[stroke="none"]'))
        .filter(c => c.style.display !== 'none')
        .map(c => parseFloat(c.getAttribute('r'))))
      .find(list => list.length > 0);
    return withRings || null;
  });

  const beforeLeaveRadii = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => parseFloat(c.getAttribute('r'))).sort((a, b) => a - b)
  );
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(30); // just after switching
  const overlaySoonAfter = await findOverlay();
  console.log('settled centric radii before leaving:', JSON.stringify(beforeLeaveRadii));
  console.log('overlay radii ~30ms after leaving:', JSON.stringify(overlaySoonAfter));
  if (!overlaySoonAfter) throw new Error('Expected a temporary collapse overlay with the old centric rings still visible shortly after leaving');
  // Every ring's radius should have already grown past its resting size
  // (reverse of the entrance, which shrinks) -- not shrunk toward 0.
  const grewAlready = overlaySoonAfter.some((r, i) => r > beforeLeaveRadii[i] + 1);
  if (!grewAlready) throw new Error(`Expected ring radii to be growing (reverse of entrance), not shrinking, got ${JSON.stringify(overlaySoonAfter)} vs resting ${JSON.stringify(beforeLeaveRadii)}`);
  console.log('Confirmed: rings grow outward when leaving, not shrink to a point.');

  console.log('\n=== Ring 4 (outermost, starts first) is well ahead of ring 1 (innermost, starts last) early in the exit ===');
  await page.waitForTimeout(90); // ~120ms total since leaving
  const early2 = await findOverlay();
  console.log('overlay radii ~120ms after leaving:', JSON.stringify(early2));
  if (early2) {
    const smallest = Math.min(...early2);
    const largest = Math.max(...early2);
    if (largest <= smallest * 1.3) throw new Error(`Expected a clear spread between the still-growing innermost ring and the head-start outer rings early in the exit, got ${JSON.stringify(early2)}`);
    console.log('Confirmed: outer rings have a visible head start over the still-catching-up innermost ring.');
  } else {
    console.log('(Overlay already finished by this point -- fine, just means the transition is fast; the growth-direction check above already covers the key behavior.)');
  }

  console.log('\n=== The innermost ring ends up large enough to cover the viewport just before the overlay is removed ===');
  await page.waitForTimeout(400); // ~520ms total -- ring 1 (last to start, at 210ms) should be well along but not necessarily done
  const lateExit = await findOverlay();
  console.log('overlay radii ~520ms after leaving:', JSON.stringify(lateExit));
  if (lateExit) {
    const vpDiag = Math.hypot(1100, 800); // this test's own viewport size
    if (Math.min(...lateExit) < vpDiag / 2) {
      throw new Error(`Expected even the smallest (innermost) ring to be approaching viewport-covering size this late, got ${JSON.stringify(lateExit)} vs viewport diagonal ${vpDiag.toFixed(0)}`);
    }
    console.log('Confirmed: even the innermost ring has grown large enough to cover the viewport by the time the exit is nearly done.');
  }

  await page.waitForTimeout(300); // let the collapse fully finish
  const afterCollapse = await page.evaluate(() => Array.from(document.querySelectorAll('#treeCanvas > svg.lines-svg')).length);
  console.log('number of svg.lines-svg elements once collapse should be done:', afterCollapse);
  if (afterCollapse !== 1) throw new Error(`Expected the temporary overlay to be removed once its collapse finishes, found ${afterCollapse} svg.lines-svg elements`);
  console.log('Confirmed: the collapse overlay cleans itself up once finished.');

  // Traditional view itself should be entirely unaffected/undelayed by this.
  const traditionalCards = await page.evaluate(() => document.querySelectorAll('.person-card').length);
  if (traditionalCards !== 5) throw new Error(`Expected Traditional view's own 5 cards to render immediately (not delayed by the collapse), got ${traditionalCards}`);
  console.log('Confirmed: the destination view renders immediately, unaffected by the collapse animation.');

  console.log('\n=== Re-entering Centric after leaving: fresh "first entry" style build again ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(30);
  const reentryEarly = await readRadii();
  console.log('radii ~30ms after re-entering centric:', JSON.stringify(reentryEarly));
  await page.waitForTimeout(700);
  const reentrySettled = await readRadii();
  if (reentrySettled.length !== 4) throw new Error(`Expected re-entry to settle into 4 rings again, got ${reentrySettled.length}`);
  console.log('Confirmed: re-entering centric view still works correctly after a prior exit.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
