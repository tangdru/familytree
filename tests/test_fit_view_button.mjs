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

  const readTransform = () => page.evaluate(() => {
    const t = document.getElementById('treeCanvas').style.transform;
    const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), scale: parseFloat(m[3]) } : null;
  });

  console.log('=== Button is visible and excluded from pan/click-to-pan detection ===');
  const btn = page.locator('#fitViewBtn');
  await btn.waitFor({ state: 'visible' });
  const box = await btn.boundingBox();
  const viewportBox = await page.locator('#treeViewport').boundingBox();
  console.log('button box:', box, 'viewport box:', viewportBox);
  if (box.x + box.width > viewportBox.x + viewportBox.width + 1) throw new Error('Button appears to overflow the viewport on the right');
  if (box.y + box.height > viewportBox.y + viewportBox.height + 1) throw new Error('Button appears to overflow the viewport on the bottom');

  console.log('\n=== Pan the view away from fit, then click the button ===');
  const before = await readTransform();
  console.log('transform before pan:', JSON.stringify(before));

  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + 30, viewport.y + 30); // empty corner, away from any card
  await page.mouse.down();
  await page.mouse.move(viewport.x + 230, viewport.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterPan = await readTransform();
  console.log('transform after pan:', JSON.stringify(afterPan));
  if (Math.abs(afterPan.x - before.x) < 50 && Math.abs(afterPan.y - before.y) < 50) {
    throw new Error('Expected the pan to meaningfully move the view before testing the fit button');
  }

  await btn.click();
  await page.waitForTimeout(80);
  const midAnimation = await readTransform();
  console.log('transform mid fit-animation:', JSON.stringify(midAnimation));
  const movedAtAll = midAnimation.x !== afterPan.x || midAnimation.y !== afterPan.y;
  if (!movedAtAll) throw new Error('Expected the view to already be moving shortly after clicking the fit button (should animate, not be instant)');

  await page.waitForTimeout(500);
  const settled = await readTransform();
  console.log('transform after fit animation settles:', JSON.stringify(settled));
  if (Math.abs(settled.x - before.x) > 1 || Math.abs(settled.y - before.y) > 1 || Math.abs(settled.scale - before.scale) > 0.001) {
    throw new Error(`Expected fit button to restore the original auto-fit transform. Was ${JSON.stringify(before)}, got ${JSON.stringify(settled)}`);
  }
  console.log('Confirmed: fit button animates back to the same transform as the initial auto-fit.');

  console.log('\n=== Clicking the button did NOT open a person view modal (pan-exclusion worked) ===');
  const modalOpen = await page.evaluate(() => !document.getElementById('personViewModal').hidden);
  if (modalOpen) throw new Error('Expected no modal to be open after clicking the fit button');
  console.log('Confirmed: no modal opened.');

  console.log('\n=== Works in chronological view too (its own content, its own fit) ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(500);
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 200, viewport.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await btn.click();
  await page.waitForTimeout(500);

  // "Fit" means the tree content is fully contained within the viewport
  // (with some padding) -- check that directly rather than comparing
  // against the traditional-view transform, since chronological content
  // has a completely different aspect ratio (it spans the full birth-year
  // range vertically), so its own fit scale is legitimately different.
  const contentBox = await page.evaluate(() => document.getElementById('treeContent').getBoundingClientRect());
  const vpBox = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  console.log('content box after chrono fit:', contentBox, 'viewport box:', vpBox);
  const pad = 26; // fitToView's own 24px padding, +2px float slop
  if (contentBox.left < vpBox.left - pad || contentBox.right > vpBox.right + pad ||
      contentBox.top < vpBox.top - pad || contentBox.bottom > vpBox.bottom + pad) {
    throw new Error('Expected chronological content to be fully contained within the viewport after fitting');
  }

  // Ruler labels should still be positioned sensibly (not stuck stale from before the fit).
  const rulerLabelTop = await page.evaluate(() => parseFloat(document.querySelector('.chrono-year-label').style.top));
  if (Number.isNaN(rulerLabelTop)) throw new Error('Expected chrono ruler labels to still be positioned after using the fit button');
  console.log('Confirmed: fit button works in chronological view, content fits, ruler stays in sync.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
