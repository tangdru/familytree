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
  const readBackgroundColor = () => page.evaluate(() => {
    const parseRgb = (s) => { const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); return m ? { r: +m[1], g: +m[2], b: +m[3] } : null; };
    return parseRgb(document.querySelector('#linesSvg rect').getAttribute('fill'));
  });

  console.log('=== Age metric settled: 4 rings, note the color of each ===');
  const ageColors = await readDiscColors();
  const ageBackground = await readBackgroundColor();
  console.log('age ring colors (by radius, innermost first):', JSON.stringify(ageColors), 'background:', JSON.stringify(ageBackground));
  if (ageColors.length !== 4) throw new Error(`Expected 4 discs in Age metric, got ${ageColors.length}`);

  // Ring color is an ABSOLUTE step keyed to ring index (see centricColorT
  // in app.js), not relative to either metric's own ring count -- so
  // rings 1-4 are the exact same fixed shades in both metrics, and
  // Location's extra 5th ring is one further fixed step darker, distinct
  // from either metric's own outermost-ring shade.
  console.log('\n=== Switch to Location: rings 1-4 keep the EXACT SAME shades as Age, ring 5 is a new, distinct, darker shade ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  await page.waitForTimeout(700);
  const locationColors = await readDiscColors();
  console.log('location ring colors (by radius, innermost first):', JSON.stringify(locationColors));
  if (locationColors.length !== 5) throw new Error(`Expected 5 discs settled in Location metric, got ${locationColors.length}`);
  for (let i = 0; i < 4; i++) {
    const a = ageColors[i].color, l = locationColors[i].color;
    if (a.r !== l.r || a.g !== l.g || a.b !== l.b) {
      throw new Error(`Expected ring ${i + 1} to be the identical absolute shade in both metrics, got Age=${JSON.stringify(a)} vs Location=${JSON.stringify(l)}`);
    }
  }
  const ring4 = locationColors[3].color;
  const ring5 = locationColors[4].color;
  if (ring4.r === ring5.r && ring4.g === ring5.g && ring4.b === ring5.b) {
    throw new Error(`Expected Location's ring 5 to be a distinct, darker shade than ring 4, both were ${JSON.stringify(ring4)}`);
  }
  console.log("Confirmed: rings 1-4 are identical absolute shades across metrics, ring 5 is a new distinct shade.");

  // Age's background (nothing past its own last ring, 4) should land on
  // the exact same absolute step as Location's real ring 5 -- Age never
  // shows that step as a ring, but it's the same shade either way.
  // Location's OWN background (nothing past its last ring, 5) should be
  // one further, distinct step darker still -- a shade Age never reaches
  // at all, since Age has no ring 5 to go one step past.
  console.log("\n=== Age's background matches Location's ring 5 exactly; Location's own background is a new, further step ===");
  const locationBackground = await readBackgroundColor();
  console.log('age background:', JSON.stringify(ageBackground), 'location background:', JSON.stringify(locationBackground));
  if (ageBackground.r !== ring5.r || ageBackground.g !== ring5.g || ageBackground.b !== ring5.b) {
    throw new Error(`Expected Age's background to match Location's ring 5 exactly, got background=${JSON.stringify(ageBackground)} vs ring5=${JSON.stringify(ring5)}`);
  }
  if (locationBackground.r === ageBackground.r && locationBackground.g === ageBackground.g && locationBackground.b === ageBackground.b) {
    throw new Error(`Expected Location's own background to be a distinct, further step than Age's background, both were ${JSON.stringify(ageBackground)}`);
  }
  console.log("Confirmed: Age's background matches Location's ring 5 exactly; Location's background is a further, distinct step.");

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

  console.log('\n=== Location -> Age (removing a ring): ring 5 starts growing out IMMEDIATELY, no stagger delay ===');
  const beforeBack = await readOuterBoundaryRadius();
  await page.click('.centric-metric-btn[data-metric="age"]');
  // The exiting ring 5 gets no stagger delay at all (same as an entering
  // ring) -- it should already be visibly growing within the first 60ms,
  // not waiting for other rings' own delays to elapse first. This is
  // deliberately NOT symmetric with removal's old "leaves last" behavior:
  // ring 5 needs to finish within the same window the cards themselves
  // move in (CARD_MOVE_MS), not lag behind them once they've settled.
  await page.waitForTimeout(60);
  const justAfterBack = await readOuterBoundaryRadius();
  console.log(`outermost boundary radius: before click ${beforeBack.toFixed(0)}, ~60ms after clicking Age ${justAfterBack.toFixed(0)}`);
  if (justAfterBack <= beforeBack) {
    throw new Error(`Expected the exiting ring 5 to already be growing within the first 60ms (no stagger delay), got ${beforeBack} then ${justAfterBack}`);
  }
  console.log('Confirmed: removing ring 5 starts growing out immediately (no stagger delay for an exiting ring).');
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
