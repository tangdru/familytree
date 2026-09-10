import { chromium } from 'playwright-core';

function person(id, name, year, opts = {}) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: opts.parents || [], spouses: opts.spouses || [], locations: [], zodiac: '' };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('a', 'Alice', 1970, { spouses: ['b'] }));
add(person('b', 'Bob', 1972, { spouses: ['a'] }));
add(person('c', 'Carol', 2000, { parents: ['a', 'b'] }));

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

  const contentFits = async () => {
    const contentBox = await page.evaluate(() => document.getElementById('treeContent').getBoundingClientRect());
    const vpBox = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
    const pad = 26;
    return contentBox.left >= vpBox.left - pad && contentBox.right <= vpBox.right + pad &&
      contentBox.top >= vpBox.top - pad && contentBox.bottom <= vpBox.bottom + pad;
  };
  const readTransform = () => page.evaluate(() => {
    const t = document.getElementById('treeCanvas').style.transform;
    const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), scale: parseFloat(m[3]) } : null;
  });

  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  const panAndZoomAway = async () => {
    await page.mouse.move(viewport.x + 30, viewport.y + 30);
    await page.mouse.down();
    await page.mouse.move(viewport.x + 300, viewport.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
  };

  console.log('=== Traditional (initial load) -> pan/zoom away -> Zodiac -> Traditional: should reframe to fit ===');
  await panAndZoomAway();
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(600);
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(600);
  if (!(await contentFits())) throw new Error('Expected Traditional view to reframe to fit when entered from Zodiac');
  console.log('Confirmed: entering Traditional from Zodiac reframes to fit.');

  console.log('\n=== Chronological entered from Centric: should reframe to fit ===');
  await panAndZoomAway();
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(600);
  if (!(await contentFits())) throw new Error('Expected Chronological view to reframe to fit when entered from Centric');
  console.log('Confirmed: entering Chronological from Centric reframes to fit.');

  console.log('\n=== Traditional -> Chronological (pan/zoom away first): should NOT reframe, unchanged ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(600);
  await panAndZoomAway();
  const beforeSwitch = await readTransform();
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(600);
  const afterSwitch = await readTransform();
  console.log('before:', JSON.stringify(beforeSwitch), 'after:', JSON.stringify(afterSwitch));
  if (Math.abs(afterSwitch.x - beforeSwitch.x) > 1 || Math.abs(afterSwitch.y - beforeSwitch.y) > 1 || Math.abs(afterSwitch.scale - beforeSwitch.scale) > 0.001) {
    throw new Error(`Expected Traditional -> Chronological to leave pan/zoom untouched, was ${JSON.stringify(beforeSwitch)} now ${JSON.stringify(afterSwitch)}`);
  }
  console.log('Confirmed: Traditional -> Chronological pan/zoom unchanged.');

  console.log('\n=== Chronological -> Traditional (pan/zoom away first): should NOT reframe, unchanged ===');
  await panAndZoomAway();
  const beforeSwitch2 = await readTransform();
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(600);
  const afterSwitch2 = await readTransform();
  console.log('before:', JSON.stringify(beforeSwitch2), 'after:', JSON.stringify(afterSwitch2));
  if (Math.abs(afterSwitch2.x - beforeSwitch2.x) > 1 || Math.abs(afterSwitch2.y - beforeSwitch2.y) > 1 || Math.abs(afterSwitch2.scale - beforeSwitch2.scale) > 0.001) {
    throw new Error(`Expected Chronological -> Traditional to leave pan/zoom untouched, was ${JSON.stringify(beforeSwitch2)} now ${JSON.stringify(afterSwitch2)}`);
  }
  console.log('Confirmed: Chronological -> Traditional pan/zoom unchanged.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
