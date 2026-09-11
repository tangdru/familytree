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
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(600);

  // The grid keeps CENTRIC_MAX_RINGS (5) disc elements alive at all times
  // now (see ensureCentricGridElements in app.js) -- a ring beyond the
  // current metric's count just sits hidden (display:none) at a parked
  // radius rather than not existing, so every query here filters those
  // out to count/measure only the rings actually on screen.
  const readBoundaryCircles = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => ({
        r: parseFloat(c.getAttribute('r')),
      }))
  );
  const readDiscColors = () => page.evaluate(() => {
    const parseRgb = (s) => { const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); return m ? { r: +m[1], g: +m[2], b: +m[3] } : null; };
    return Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => ({ r: parseFloat(c.getAttribute('r')), color: parseRgb(c.getAttribute('fill')) }))
      .sort((a, b) => a.r - b.r);
  });

  console.log('=== Age metric settled: 4 rings, note the color of each ===');
  const ageColors = await readDiscColors();
  console.log('age ring colors (by radius, innermost first):', JSON.stringify(ageColors));
  if (ageColors.length !== 4) throw new Error(`Expected 4 discs in Age metric, got ${ageColors.length}`);

  // Location has 5 tiers (city/region/country/hemisphere/elsewhere) vs
  // Age's 4, and ring color is relative to EACH metric's own ring count
  // (see centricRingCount) -- so only the outermost ring is guaranteed to
  // reach the same shade across metrics; inner rings can differ slightly.
  console.log('\n=== Switch to Location: its OUTERMOST ring matches Age\'s outermost ring color exactly ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const locationColors = await readDiscColors();
  console.log('location ring colors (by radius, innermost first):', JSON.stringify(locationColors));
  if (locationColors.length !== 5) throw new Error(`Expected 5 discs settled in Location metric, got ${locationColors.length}`);
  const ageOutermost = ageColors[ageColors.length - 1].color;
  const locationOutermost = locationColors[locationColors.length - 1].color;
  if (ageOutermost.r !== locationOutermost.r || ageOutermost.g !== locationOutermost.g || ageOutermost.b !== locationOutermost.b) {
    throw new Error(`Expected Location's outermost ring to match Age's outermost ring color exactly, got ${JSON.stringify(locationOutermost)} vs ${JSON.stringify(ageOutermost)}`);
  }
  console.log("Confirmed: Location's outermost ring matches Age's outermost ring color exactly.");

  const boundariesAfterToLocation = await readBoundaryCircles();
  if (boundariesAfterToLocation.length !== 5) throw new Error(`Expected exactly 5 settled boundary rings in Location metric, got ${boundariesAfterToLocation.length}`);
  console.log('Confirmed: all 5 rings present once settled in Location metric.');

  // Location has MORE rings than Age, so going Age -> Location makes the
  // 5th ring appear (shrinks in immediately, no stagger delay -- see
  // animateCentricGrid's addingRingsToExisting), and Location -> Age
  // makes it disappear (grows out, waiting its turn like every removal).
  console.log('\n=== Age -> Location (adding a ring): the new ring 5 starts shrinking in IMMEDIATELY ===');
  await page.click('.centric-metric-btn[data-metric="age"]'); // back to Age to reset
  await page.waitForTimeout(700);
  const readOuterBoundaryRadius = () => page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => parseFloat(c.getAttribute('r'))))
  );
  await page.click('.centric-metric-btn[data-metric="location"]');
  // The new ring 5 starts at a huge off-screen radius and shrinks toward
  // its resting size with NO stagger delay (unlike an exiting ring) -- so
  // two early post-click samples should already show it decreasing,
  // rather than comparing against the pre-click (unrelated, ring-4-only)
  // baseline, which the huge starting radius is naturally still above.
  await page.waitForTimeout(30); // very early -- should already be shrinking if immediate (no stagger delay)
  const veryEarly = await readOuterBoundaryRadius();
  await page.waitForTimeout(60);
  const bitLater = await readOuterBoundaryRadius();
  console.log(`outermost boundary radius: ~30ms after click ${veryEarly.toFixed(0)}, ~90ms after click ${bitLater.toFixed(0)}`);
  if (bitLater >= veryEarly) {
    throw new Error(`Expected the newly-appearing ring 5 to already be shrinking within the first 90ms (no stagger delay), got ${veryEarly} then ${bitLater}`);
  }
  console.log('Confirmed: the newly-appearing ring 5 starts shrinking in immediately (no stagger delay for an added ring).');
  await page.waitForTimeout(700);

  console.log('\n=== Location -> Age (removing a ring): ring 5 still leaves LAST (starts moving late) ===');
  const beforeBack = await readOuterBoundaryRadius();
  await page.click('.centric-metric-btn[data-metric="age"]');
  await page.waitForTimeout(60); // still within ring 5's own stagger delay -- should NOT have moved yet
  const justAfterBack = await readOuterBoundaryRadius();
  console.log(`outermost boundary radius: before click ${beforeBack.toFixed(0)}, ~60ms after clicking Age ${justAfterBack.toFixed(0)}`);
  if (Math.abs(justAfterBack - beforeBack) > 1) {
    throw new Error(`Expected the exiting ring 5 to still be stationary this early (innermost-first stagger for removal), moved from ${beforeBack} to ${justAfterBack}`);
  }
  console.log('Confirmed: removing ring 5 waits its turn before leaving (innermost rings settle first).');
  await page.waitForTimeout(700);
  const settledBack = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .filter(c => c.style.display !== 'none')
      .map(c => parseFloat(c.getAttribute('r'))).sort((a, b) => a - b)
  );
  if (settledBack.length !== 4) throw new Error(`Expected 4 rings settled back in Age metric, got ${settledBack.length}`);
  console.log('Confirmed: settles back to exactly 4 rings in Age metric.');

  console.log('\n=== The grid origin never moves during a transition (no more "sliding from the side") ===');
  const readOrigin = () => page.evaluate(() => {
    const bg = document.querySelector('#linesSvg rect');
    const r = parseFloat(bg.getAttribute('width')) / 2;
    return { x: parseFloat(bg.getAttribute('x')) + r, y: parseFloat(bg.getAttribute('y')) + r };
  });
  await page.click('[data-id="f1"]'); // recenter, a real transition
  await page.waitForTimeout(20); // let the first requestAnimationFrame actually draw the grid
  const origins = [];
  for (let i = 0; i < 5; i++) {
    origins.push(await readOrigin());
    await page.waitForTimeout(60);
  }
  console.log('origin samples during transition:', JSON.stringify(origins));
  for (let i = 1; i < origins.length; i++) {
    if (Math.abs(origins[i].x - origins[0].x) > 1 || Math.abs(origins[i].y - origins[0].y) > 1) {
      throw new Error(`Expected the origin to stay fixed throughout the transition, got ${JSON.stringify(origins[0])} then ${JSON.stringify(origins[i])}`);
    }
  }
  console.log('Confirmed: origin is constant throughout the transition (only radii animate).');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
