import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', locations: ['Seattle, WA', 'Portland, OR', 'Denver, CO'], parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);

  const rowOrder = () => page.evaluate(() => Array.from(document.querySelectorAll('.location-row-input')).map(el => el.textContent));
  const tagVisibility = () => page.evaluate(() => Array.from(document.querySelectorAll('.location-row')).map(r => !r.querySelector('.location-current-tag').hidden));

  console.log('=== Initial order ===');
  console.log(JSON.stringify(await rowOrder()));
  console.log('current tag visibility:', JSON.stringify(await tagVisibility()));

  console.log('\n=== Drag the 3rd row (Denver) to the top via its handle ===');
  const handles = await page.$$('.location-row-handle');
  if (handles.length !== 3) throw new Error('Expected 3 drag handles');
  const thirdBox = await handles[2].boundingBox();
  const firstBox = await handles[0].boundingBox();

  await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(30);
  // Move up past the first row's midpoint, in a few steps so intermediate
  // reorder checks fire (mirrors real pointermove granularity).
  const steps = 6;
  const startY = thirdBox.y + thirdBox.height / 2;
  const endY = firstBox.y + firstBox.height / 2 - 5;
  for (let i = 1; i <= steps; i++) {
    const y = startY + (endY - startY) * (i / steps);
    await page.mouse.move(thirdBox.x + thirdBox.width / 2, y, { steps: 3 });
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(50);

  console.log('order mid-drag:', JSON.stringify(await rowOrder()));
  console.log('tag visibility mid-drag:', JSON.stringify(await tagVisibility()));

  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterDrag = await rowOrder();
  const afterTags = await tagVisibility();
  console.log('order after drop:', JSON.stringify(afterDrag));
  console.log('tag visibility after drop:', JSON.stringify(afterTags));
  if (afterDrag[0] !== 'Denver, CO') throw new Error('Expected Denver to be dragged to the top (now current)');
  if (!afterTags[0] || afterTags[1] || afterTags[2]) throw new Error('Expected only the new first row to show the Current tag');

  console.log('\n=== Save and confirm the new order persists ===');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved locations:', JSON.stringify(saved.locations));
  if (saved.locations[0] !== 'Denver, CO') throw new Error('Expected the reordered list to persist on save');

  console.log('\n=== Saving returns to the view card: meta row should now read Denver as current ===');
  const viewMeta = await page.textContent('#viewMeta');
  console.log('view card meta row:', viewMeta);
  if (!viewMeta.includes('Denver, CO')) throw new Error('Expected the meta row to show Denver as current after reordering');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
