import { chromium } from 'playwright-core';

const gp1 = 'gp1', gp2 = 'gp2', p1 = 'p1', p2 = 'p2', c1 = 'c1', c2 = 'c2';
const people = {
  [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2], zodiac: 'Tiger' },
  [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1], zodiac: 'Pig' },
  [p1]: { id: p1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [p2], zodiac: 'Tiger' },
  [p2]: { id: p2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1], zodiac: 'Rat' },
  [c1]: { id: c1, name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [], zodiac: 'Tiger' },
  [c2]: { id: c2, name: 'Tom Doe', birthDate: '', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [], zodiac: '' },
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

  console.log('=== Pan/zoom away in traditional view, then switch to Zodiac: should always reframe ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 400, viewport.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);
  const beforeSwitch = await readTransform();
  console.log('transform before switching to zodiac:', JSON.stringify(beforeSwitch));

  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(600);
  const afterSwitch = await readTransform();
  console.log('transform after switching to zodiac:', JSON.stringify(afterSwitch));

  // A real fit-to-view recomputes scale/position from the zodiac content's
  // own (much wider) bounding box -- it should differ from whatever the
  // panned/zoomed traditional-view transform was.
  const changed = Math.abs(afterSwitch.x - beforeSwitch.x) > 1 || Math.abs(afterSwitch.y - beforeSwitch.y) > 1 || Math.abs(afterSwitch.scale - beforeSwitch.scale) > 0.001;
  if (!changed) throw new Error('Expected switching to zodiac view to reframe (fit to screen), but the transform did not change');

  const contentBox = await page.evaluate(() => document.getElementById('treeContent').getBoundingClientRect());
  const vpBox = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  const pad = 26;
  if (contentBox.left < vpBox.left - pad || contentBox.right > vpBox.right + pad ||
      contentBox.top < vpBox.top - pad || contentBox.bottom > vpBox.bottom + pad) {
    throw new Error('Expected zodiac content to be fully framed (fit to view) after switching in');
  }
  console.log('Confirmed: switching into zodiac view always reframes to fit the content.');

  console.log('\n=== Re-panning and switching to zodiac again still reframes every time ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 250, viewport.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const beforeSecond = await readTransform();
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(600);
  const afterSecond = await readTransform();
  const changedAgain = Math.abs(afterSecond.x - beforeSecond.x) > 1 || Math.abs(afterSecond.y - beforeSecond.y) > 1;
  if (!changedAgain) throw new Error('Expected zodiac view to reframe again on a second entry too, not just the first time');
  console.log('Confirmed: reframes every time you enter zodiac view, not just once.');

  console.log('\n=== Within a shared column, oldest is on top, youngest at the bottom ===');
  const tigerTops = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.person-card'));
    const tigerLeft = Array.from(document.querySelectorAll('.zodiac-column-header'))
      .find(h => h.querySelector('.zodiac-header-label').textContent === 'Tiger').offsetLeft;
    return cards.filter(c => c.offsetLeft === tigerLeft)
      .map(c => ({ name: c.querySelector('.person-name').textContent, top: c.offsetTop }))
      .sort((a, b) => a.top - b.top);
  });
  console.log('Tiger column, top to bottom:', JSON.stringify(tigerTops));
  const names = tigerTops.map(t => t.name);
  const expectedOrder = ['Eleanor Hart', 'Susan Hart', 'Jane Doe']; // 1938, 1962, 1990 -- oldest first
  if (JSON.stringify(names) !== JSON.stringify(expectedOrder)) {
    throw new Error(`Expected Tiger column top-to-bottom order ${JSON.stringify(expectedOrder)} (oldest to youngest), got ${JSON.stringify(names)}`);
  }
  console.log('Confirmed: oldest-to-youngest, top-to-bottom ordering within a column.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
