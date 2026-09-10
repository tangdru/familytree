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

  const countGridlines = () => page.evaluate(() => {
    // Gridlines are the only <line> elements drawn with stroke-width 1 --
    // connector lines (also plain <line>s for straight segments) all use
    // the default width of 2, so this reliably isolates just the grid.
    return Array.from(document.querySelectorAll('#linesSvg > line'))
      .filter(el => el.getAttribute('stroke-width') === '1').length;
  });

  console.log('=== Switch to chronological: gridlines should appear immediately ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(50); // right after the render's first rAF, before the 380ms animation settles
  const immediately = await countGridlines();
  console.log('gridlines right after switch:', immediately);
  if (immediately === 0) throw new Error('Expected gridlines to be present immediately after switching to chronological view');

  console.log('\n=== After the layout animation settles, gridlines should still be present ===');
  await page.waitForTimeout(500);
  const settled = await countGridlines();
  console.log('gridlines after settling:', settled);
  if (settled === 0) throw new Error('Expected gridlines to persist after the animation settles');
  if (settled !== immediately) throw new Error(`Expected the same gridline count before/after animation (had ${immediately}, now ${settled})`);

  console.log('\n=== Panning/zooming (triggers drawLines via other paths) should not wipe gridlines ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(150);
  const afterZoom = await countGridlines();
  console.log('gridlines after zoom:', afterZoom);
  if (afterZoom === 0) throw new Error('Expected gridlines to still be present after zooming');

  console.log('\n=== Switching back to traditional and then to chronological again still works ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(500);
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(500);
  const afterToggle = await countGridlines();
  console.log('gridlines after toggling view modes:', afterToggle);
  if (afterToggle === 0) throw new Error('Expected gridlines to reappear after switching back to chronological view');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
