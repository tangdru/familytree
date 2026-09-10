import { chromium } from 'playwright-core';

// A tall single column (many people sharing one zodiac sign) so the
// content is much taller than the 700px viewport -- a normal (both-axis)
// fit would have to shrink far more than a horizontal-only fit needs to.
function person(id, name, year) {
  return { id, name, birthDate: `${year}-01-01`, deathDate: '', photo: '', notes: '', parents: [], spouses: [], zodiac: 'Rat' };
}
const people = {};
for (let i = 0; i < 16; i++) {
  const id = `p${i}`;
  people[id] = person(id, `Rat Person ${i}`, 1970 + i * 4);
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

  console.log('=== Switch to Zodiac view: width should be fit, height should NOT be shrunk to fit ===');
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(600);

  const measurements = await page.evaluate(() => {
    const content = document.getElementById('treeContent');
    const viewport = document.getElementById('treeViewport').getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    return {
      contentWidthCss: content.offsetWidth,
      contentHeightCss: content.offsetHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      renderedWidth: contentBox.width,
      renderedHeight: contentBox.height,
      contentTop: contentBox.top - viewport.top,
      contentLeft: contentBox.left - viewport.left,
    };
  });
  console.log(JSON.stringify(measurements, null, 2));

  // Width should be fit (comfortably within the viewport width, close to it
  // minus the ~24px*2 padding fitToView uses).
  if (measurements.renderedWidth > measurements.viewportWidth + 4) {
    throw new Error(`Expected content width to fit within the viewport (${measurements.viewportWidth}px), got ${measurements.renderedWidth}px`);
  }
  const expectedMinWidth = measurements.viewportWidth - 60; // fitToView's padding is 24px/side; leave slack
  if (measurements.renderedWidth < expectedMinWidth) {
    throw new Error(`Expected content to be scaled UP to fill available width (expected >= ${expectedMinWidth}px), got ${measurements.renderedWidth}px -- looks like height is still constraining the scale`);
  }
  console.log('Confirmed: content width is fit to the viewport width.');

  // Height should legitimately overflow the viewport (that's the point --
  // we did NOT shrink further just to make the tall column fit vertically).
  if (measurements.renderedHeight <= measurements.viewportHeight) {
    throw new Error(`Expected the tall zodiac column to overflow the viewport height (content height ${measurements.renderedHeight}px should exceed viewport height ${measurements.viewportHeight}px) -- otherwise this isn't testing a real height/width conflict`);
  }
  console.log('Confirmed: content height overflows the viewport (not shrunk to fit vertically).');

  // Content should be top-aligned (not vertically centered, which would
  // push part of the top -- including the column header -- off-screen).
  if (Math.abs(measurements.contentTop - 24) > 3) {
    throw new Error(`Expected content to be top-aligned near the 24px fit padding, got contentTop=${measurements.contentTop}`);
  }
  console.log('Confirmed: content is top-aligned so the column header stays visible.');

  console.log('\n=== The fit-view button also does a horizontal-only fit while in zodiac view ===');
  // Zoom out first, then click fit -- confirm it returns to a horizontal fit, not a bothaxis one.
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  await page.click('#fitViewBtn');
  await page.waitForTimeout(500);
  const afterButtonFit = await page.evaluate(() => document.getElementById('treeContent').getBoundingClientRect().width);
  const vpWidth = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect().width);
  if (afterButtonFit < vpWidth - 60 || afterButtonFit > vpWidth + 4) {
    throw new Error(`Expected the fit button to redo a horizontal-only fit in zodiac view, width was ${afterButtonFit} vs viewport ${vpWidth}`);
  }
  console.log('Confirmed: fit-view button also does horizontal-only fit in zodiac view.');

  console.log('\n=== Traditional view still fits BOTH axes (unaffected by this change) ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(500);
  await page.click('#fitViewBtn');
  await page.waitForTimeout(500);
  const traditionalBox = await page.evaluate(() => {
    const content = document.getElementById('treeContent').getBoundingClientRect();
    const viewport = document.getElementById('treeViewport').getBoundingClientRect();
    return { width: content.width, height: content.height, vpWidth: viewport.width, vpHeight: viewport.height };
  });
  if (traditionalBox.height > traditionalBox.vpHeight + 4) {
    throw new Error(`Expected traditional view's fit to still respect height too, height was ${traditionalBox.height} vs viewport ${traditionalBox.vpHeight}`);
  }
  console.log('Confirmed: traditional view fit is unaffected (still fits both axes).');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
