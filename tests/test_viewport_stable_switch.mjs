import { chromium } from 'playwright-core';

const dad = 'dad', mom = 'mom', kid1 = 'kid1', kid2 = 'kid2';
const people = {
  [dad]: { id: dad, name: 'Papa Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [mom] },
  [mom]: { id: mom, name: 'Mama Doe', birthDate: '1952-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [dad] },
  [kid1]: { id: kid1, name: 'Kid One Doe', birthDate: '1980-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [kid2]: { id: kid2, name: 'Kid Two Doe', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
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

  console.log('=== Pan/zoom away from the auto-fit default, then note the exact transform ===');
  await page.mouse.wheel(0, -200); // zoom in a bit (wheel handler)
  await page.waitForTimeout(100);
  // Drag from a corner well clear of any card, so this pans the canvas
  // instead of accidentally registering as a click on a card.
  await page.mouse.move(30, 30);
  await page.mouse.down();
  await page.mouse.move(130, 130, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const transformBefore = await page.evaluate(() => document.getElementById('treeCanvas').style.transform);
  console.log('transform before switch:', transformBefore);

  console.log('\n=== Switch to Chronological: transform should be UNCHANGED (no auto-refit) ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(600); // let any layout animation fully settle
  const transformAfterChrono = await page.evaluate(() => document.getElementById('treeCanvas').style.transform);
  console.log('transform after switching to chronological:', transformAfterChrono);
  if (transformAfterChrono !== transformBefore) {
    throw new Error(`Expected the pan/zoom transform to stay identical across the mode switch. Before: ${transformBefore}, after: ${transformAfterChrono}`);
  }
  console.log('Confirmed: viewport (pan/zoom) unchanged by the mode switch.');

  console.log('\n=== Switch back to Traditional: transform should STILL be unchanged ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(600);
  const transformAfterTraditional = await page.evaluate(() => document.getElementById('treeCanvas').style.transform);
  console.log('transform after switching back:', transformAfterTraditional);
  if (transformAfterTraditional !== transformBefore) {
    throw new Error(`Expected the pan/zoom transform to stay identical switching back too. Before: ${transformBefore}, after: ${transformAfterTraditional}`);
  }
  console.log('Confirmed: still unchanged.');

  console.log('\n=== Chrono ruler fades via opacity, not hidden attribute ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(30); // sample early in the fade
  const earlyOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('chronoRuler')).opacity));
  console.log('ruler opacity ~30ms after switching in (expect between 0 and 1, mid-fade):', earlyOpacity);
  await page.waitForTimeout(500);
  const settledOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('chronoRuler')).opacity));
  console.log('ruler opacity after settling (expect 1):', settledOpacity);
  if (settledOpacity !== 1) throw new Error('Expected the chrono ruler to fully fade in to opacity 1');
  const hiddenAttr = await page.evaluate(() => document.getElementById('chronoRuler').hidden);
  console.log('ruler "hidden" attribute (expect false, now class-driven):', hiddenAttr);
  if (hiddenAttr) throw new Error('Expected the ruler to no longer use the hidden attribute');

  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(500);
  const fadedOutOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('chronoRuler')).opacity));
  console.log('ruler opacity after switching back to traditional (expect 0):', fadedOutOpacity);
  if (fadedOutOpacity !== 0) throw new Error('Expected the chrono ruler to fade back out to opacity 0');

  console.log('\n=== Sanity: clicking a card after all this still opens its view ===');
  await page.click(`.person-card[data-id="${kid1}"]`);
  await page.waitForTimeout(200);
  const viewName = await page.evaluate(() => document.getElementById('viewName').textContent);
  console.log('opened view for:', viewName);
  if (viewName !== 'Kid One Doe') throw new Error('Expected clicking the card to open its Person View, got: ' + viewName);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
