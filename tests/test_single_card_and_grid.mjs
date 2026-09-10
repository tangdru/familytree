import { chromium } from 'playwright-core';

// A married couple (Alice/Bob, spouses of each other) plus a few others,
// so clicking either spouse in Zodiac/Centric view can be checked against
// the old "opens paired Couple View" behavior.
const A = 'A', B = 'B', C = 'C', D = 'D';
const people = {
  [A]: { id: A, name: 'Alice Center', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [B], locations: ['Boston, USA'], zodiac: 'Dog' },
  [B]: { id: B, name: 'Bob Spouse', birthDate: '1971-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [A], locations: ['Boston, USA'], zodiac: 'Pig' },
  [C]: { id: C, name: 'Carol Mid', birthDate: '1982-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: ['Boston, USA'], zodiac: 'Dog' },
  [D]: { id: D, name: 'Dave Far', birthDate: '1995-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: ['Paris, France'], zodiac: 'Pig' },
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

  console.log('=== Sanity check: clicking Alice in TRADITIONAL view opens the paired Couple View ===');
  await page.click(`[data-id="${A}"]`);
  await page.waitForTimeout(300);
  const isCoupleInTraditional = await page.evaluate(() => !document.getElementById('viewCouple').hidden);
  if (!isCoupleInTraditional) throw new Error('Expected Traditional view to still open the Couple View for a married person (unchanged baseline)');
  console.log('Confirmed: Traditional view behavior is unchanged (couple view for a spouse).');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Zodiac view: clicking Alice (has a spouse) opens the SINGLE Person View, not Couple View ===');
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(600);
  await page.click(`[data-id="${A}"]`);
  await page.waitForTimeout(300);
  const singleHiddenZodiac = await page.evaluate(() => document.getElementById('viewPersonSingle').hidden);
  const coupleHiddenZodiac = await page.evaluate(() => document.getElementById('viewCouple').hidden);
  if (singleHiddenZodiac || !coupleHiddenZodiac) {
    throw new Error(`Expected single Person View in zodiac view (singleHidden=${singleHiddenZodiac}, coupleHidden=${coupleHiddenZodiac})`);
  }
  const zodiacModalName = await page.evaluate(() => document.getElementById('viewName').textContent);
  if (!zodiacModalName.includes('Alice')) throw new Error(`Expected modal to show Alice, got "${zodiacModalName}"`);
  console.log('Confirmed: zodiac view opens single Person View even for a married person.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Centric view: clicking the center card (which has a spouse) also opens the SINGLE Person View ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(600);
  // Default center is Alice (first person) -- clicking her (already centered) opens her modal.
  await page.click(`[data-id="${A}"]`);
  await page.waitForTimeout(300);
  const singleHiddenCentric = await page.evaluate(() => document.getElementById('viewPersonSingle').hidden);
  const coupleHiddenCentric = await page.evaluate(() => document.getElementById('viewCouple').hidden);
  if (singleHiddenCentric || !coupleHiddenCentric) {
    throw new Error(`Expected single Person View in centric view (singleHidden=${singleHiddenCentric}, coupleHidden=${coupleHiddenCentric})`);
  }
  console.log('Confirmed: centric view opens single Person View even for a married center person.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Each person still gets their OWN individual card in Zodiac view (no merged couple card) ===');
  const zodiacCardCount = await page.evaluate(() => document.querySelectorAll('.person-card').length);
  if (zodiacCardCount !== 4) throw new Error(`Expected 4 individual cards in zodiac view, found ${zodiacCardCount}`);
  console.log('Confirmed: 4 individual cards, no merged couple card.');

  console.log('\n=== Concentric grid: dashed boundary circles + axis labels appear, one per ring, matching the metric ===');
  const grid = await page.evaluate(() => {
    const boundaryCircles = Array.from(document.querySelectorAll('#linesSvg circle[stroke-dasharray]')).map(c => parseFloat(c.getAttribute('r')));
    const labels = Array.from(document.querySelectorAll('#linesSvg text')).map(t => t.textContent);
    return { boundaryCircles, labels };
  });
  console.log('boundary circles (radii):', JSON.stringify(grid.boundaryCircles), 'labels:', JSON.stringify(grid.labels));
  if (grid.boundaryCircles.length < 2) throw new Error(`Expected at least 2 concentric ring circles, got ${grid.boundaryCircles.length}`);
  if (grid.boundaryCircles.length !== grid.labels.length) throw new Error('Expected exactly one axis label per gridline circle');
  const sorted = [...grid.boundaryCircles].sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(grid.boundaryCircles)) throw new Error('Expected ring circles listed in increasing radius order');
  if (!grid.labels.some(l => /yrs/.test(l))) throw new Error('Expected age-metric labels (e.g. "0–5 yrs") by default');
  console.log('Confirmed: concentric gridlines + axis labels present and ordered by radius, age-metric labels shown.');

  console.log('\n=== Distinct stepped ring colors: each ring is a flat, distinct color, darkening outward, background continues the sequence ===');
  const stepInfo = await page.evaluate(() => {
    const parseRgb = (str) => {
      const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    };
    const discs = Array.from(document.querySelectorAll('#linesSvg circle[stroke="none"]'))
      .map(c => ({ r: parseFloat(c.getAttribute('r')), color: parseRgb(c.getAttribute('fill')) }))
      .sort((a, b) => a.r - b.r);
    const bg = document.querySelector('#linesSvg rect');
    return { discs, background: bg ? parseRgb(bg.getAttribute('fill')) : null };
  });
  console.log('ring discs (innermost to outermost):', JSON.stringify(stepInfo.discs));
  console.log('background (beyond outermost ring):', JSON.stringify(stepInfo.background));
  if (!stepInfo.background) throw new Error('Expected a background <rect> covering the canvas beyond the outermost ring');
  if (stepInfo.discs.length < 2) throw new Error(`Expected at least 2 ring discs, got ${stepInfo.discs.length}`);

  // Luminance (perceived brightness) should strictly decrease ring by
  // ring, then again one more step into the background -- distinct flat
  // steps, not a blend, but each step still darker than the last.
  const luminance = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const sequence = [...stepInfo.discs.map(d => d.color), stepInfo.background];
  for (let i = 1; i < sequence.length; i++) {
    if (luminance(sequence[i]) >= luminance(sequence[i - 1])) {
      throw new Error(`Expected each step to be strictly darker than the previous (center to background), step ${i} (${JSON.stringify(sequence[i])}) was not darker than step ${i - 1} (${JSON.stringify(sequence[i - 1])})`);
    }
  }
  // Each ring's color should be genuinely distinct (a visible step), not
  // an imperceptible near-duplicate of its neighbor.
  for (let i = 1; i < sequence.length; i++) {
    const diff = Math.abs(luminance(sequence[i]) - luminance(sequence[i - 1]));
    if (diff < 5) throw new Error(`Expected a clearly distinct step between ring colors, got a luminance difference of only ${diff.toFixed(1)}`);
  }
  // The outermost ring should not be near-black (the earlier gradient's
  // "too dark" problem) -- keep it at least moderately light.
  const outermostLuminance = luminance(stepInfo.discs[stepInfo.discs.length - 1].color);
  if (outermostLuminance < 80) throw new Error(`Expected the outermost ring to stay moderately light (luminance >= 80), got ${outermostLuminance.toFixed(1)}`);
  console.log('Confirmed: distinct, strictly-darkening flat color steps from center through the background, outermost ring not too dark.');

  console.log('\n=== Switching to Location metric updates the axis labels ===');
  await page.click('.centric-metric-btn[data-metric="location"]');
  // The grid's own transition (see animateCentricGrid) staggers each
  // ring's build by CENTRIC_RING_STAGGER_MS, so with up to 4 rings
  // involved the whole thing can take noticeably longer than a single
  // ring's own CARD_MOVE_MS -- wait past centricTransitionDuration(4)
  // worth of margin before checking the final, settled label set.
  await page.waitForTimeout(700);
  const locationLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#linesSvg text')).map(t => t.textContent));
  console.log('location labels:', JSON.stringify(locationLabels));
  if (locationLabels.length !== 5) throw new Error(`Expected exactly 5 settled location-metric labels, got ${JSON.stringify(locationLabels)}`);
  for (const expected of ['Same city', 'Same region', 'Same country', 'Same hemisphere', 'Elsewhere']) {
    if (!locationLabels.includes(expected)) throw new Error(`Expected a "${expected}" label, got ${JSON.stringify(locationLabels)}`);
  }
  console.log('Confirmed: axis labels update when the metric toggle changes.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
