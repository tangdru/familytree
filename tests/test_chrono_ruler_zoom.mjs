import { chromium } from 'playwright-core';

const gp1 = 'gp1', gp2 = 'gp2', p1 = 'p1', p2 = 'p2', c1 = 'c1', c2 = 'c2';
const people = {
  [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2] },
  [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1] },
  [p1]: { id: p1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [p2] },
  [p2]: { id: p2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1] },
  [c1]: { id: c1, name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [] },
  [c2]: { id: c2, name: 'Tom Doe', birthDate: '1993-08-30', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [] },
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
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(500);

  const measure = () => page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.chrono-year-label:not(.today)'))
      .map(el => ({ text: el.textContent, top: parseFloat(el.style.top), fontSize: parseFloat(getComputedStyle(el).fontSize) }))
      .sort((a, b) => parseInt(a.text) - parseInt(b.text));
    return labels;
  });

  const readScale = () => page.evaluate(() => {
    const t = document.getElementById('treeCanvas').style.transform;
    const m = t.match(/scale\(([\d.]+)\)/);
    return m ? parseFloat(m[1]) : null;
  });

  console.log('=== At default (auto-fit) zoom -- NOT necessarily scale 1.0 ===');
  const at1x = await measure();
  const scale1x = await readScale();
  console.log(JSON.stringify(at1x.slice(0, 3)), 'view.scale:', scale1x);
  const gap1x = at1x[1].top - at1x[0].top;
  console.log('gap between first two decade labels:', gap1x, 'fontSize:', at1x[0].fontSize);
  // Sanity check on the test's own math, independent of whatever the
  // auto-fit scale happens to be: gap should be exactly 10 years * 12px/yr
  // (CHRONO_PX_PER_YEAR) * the current scale.
  if (Math.abs(gap1x - 120 * scale1x) > 1) {
    throw new Error(`Test assumption broken: expected gap ${120 * scale1x} (120 * scale ${scale1x}), got ${gap1x}`);
  }

  console.log('\n=== Zoom in (wheel), then re-measure ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -800); // zoom in significantly
  await page.waitForTimeout(150);
  const scaleAfterZoomIn = await readScale();
  console.log('view.scale after zooming in:', scaleAfterZoomIn);
  const atZoomIn = await measure();
  console.log(JSON.stringify(atZoomIn.slice(0, 3)));
  const gapZoomIn = atZoomIn[1].top - atZoomIn[0].top;
  console.log('gap between first two decade labels:', gapZoomIn, 'fontSize:', atZoomIn[0].fontSize);

  if (atZoomIn[0].fontSize !== at1x[0].fontSize) {
    throw new Error(`Expected font size to stay constant across zoom levels. At 1x: ${at1x[0].fontSize}, zoomed in: ${atZoomIn[0].fontSize}`);
  }
  console.log('Confirmed: font size unchanged by zoom.');

  const expectedGapZoomIn = gap1x * (scaleAfterZoomIn / scale1x);
  if (Math.abs(gapZoomIn - expectedGapZoomIn) > 1) {
    throw new Error(`Expected the gap between labels to scale with zoom (~${expectedGapZoomIn.toFixed(1)}px), got ${gapZoomIn.toFixed(1)}px`);
  }
  console.log(`Confirmed: label spacing scaled with zoom (expected ~${expectedGapZoomIn.toFixed(1)}px, got ${gapZoomIn.toFixed(1)}px).`);

  console.log('\n=== Labels never overflow their 56px column, even zoomed in ===');
  const widths = await page.evaluate(() => Array.from(document.querySelectorAll('.chrono-year-label')).map(el => el.getBoundingClientRect().width));
  console.log('label widths:', JSON.stringify(widths));
  const rulerWidth = await page.evaluate(() => document.getElementById('chronoRuler').getBoundingClientRect().width);
  console.log('ruler column width:', rulerWidth);
  if (widths.some(w => w > rulerWidth)) throw new Error('Expected every label to fit within the ruler column width');

  console.log('\n=== Zoom back out past 1x: font size still constant, gap shrinks accordingly ===');
  await page.mouse.wheel(0, 1400); // zoom out well past the original
  await page.waitForTimeout(150);
  const scaleAfterZoomOut = await readScale();
  console.log('view.scale after zooming out:', scaleAfterZoomOut);
  const atZoomOut = await measure();
  const gapZoomOut = atZoomOut[1].top - atZoomOut[0].top;
  console.log('gap:', gapZoomOut, 'fontSize:', atZoomOut[0].fontSize);
  if (atZoomOut[0].fontSize !== at1x[0].fontSize) throw new Error('Expected font size to stay constant zoomed out too');
  const expectedGapZoomOut = gap1x * (scaleAfterZoomOut / scale1x);
  if (Math.abs(gapZoomOut - expectedGapZoomOut) > 1) {
    throw new Error(`Expected gap ~${expectedGapZoomOut.toFixed(1)}px zoomed out, got ${gapZoomOut.toFixed(1)}px`);
  }
  console.log('Confirmed zoomed-out behavior too.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
