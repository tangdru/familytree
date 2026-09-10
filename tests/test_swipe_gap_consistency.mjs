import { chromium } from 'playwright-core';

const andrew = 'andrew';
const christine = 'christine';
const max = 'max';
const people = {
  [andrew]: {
    id: andrew, name: 'Andrew An Tang', birthDate: '1978-11-23', deathDate: '', photo: '', notes: '',
    locations: ['Somerville, Massachusetts', 'Melrose, Massachusetts', 'Bellingham, Washington', 'Tacoma, Washington'],
    contacts: ['617-555-1234', 'andrew@gmail.com'], zodiac: 'Horse',
    parents: [], spouses: [christine],
  },
  [christine]: { id: christine, name: 'Christine Chan', birthDate: '1982-12-29', deathDate: '', photo: '', notes: '', parents: [], spouses: [andrew] },
  [max]: { id: max, name: 'Max Summer Tang Chan', birthDate: '2023-04-05', deathDate: '', photo: '', notes: '', locations: ['Melrose, Massachusetts'], parents: [andrew, christine], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 950 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Max Summer Tang Chan")');
  await page.waitForTimeout(250);

  const restRect = await page.evaluate(() => document.getElementById('personViewCard').getBoundingClientRect());
  console.log('Max (outgoing) card rect:', JSON.stringify(restRect));

  console.log('\n=== Drag down (Max -> reveal Andrew/Christine couple, a much taller card): measure the live gap mid-drag ===');
  const zoneBox = await page.locator('#viewSwipeZone').boundingBox();
  const cx = zoneBox.x + zoneBox.width / 2;
  const cy = zoneBox.y + zoneBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 40, { steps: 4 }); // small, well under threshold -- just enough to capture+mount
  await page.waitForTimeout(50);

  const gapInfo = await page.evaluate(() => {
    const layer = document.querySelector('.swipe-drag-layer');
    const out = layer.querySelector('.swipe-card-outgoing');
    const inc = layer.querySelector('.swipe-card-incoming');
    const outRect = out.getBoundingClientRect();
    const incRect = inc.getBoundingClientRect();
    return {
      outTop: outRect.top,
      incBottom: incRect.bottom,
      gap: outRect.top - incRect.bottom,
      outHeight: outRect.height,
      incHeight: incRect.height,
    };
  });
  console.log(JSON.stringify(gapInfo, null, 2));

  await page.mouse.up();
  await page.waitForTimeout(400);

  const expectedGap = restRect.top; // the modal's own top margin, per startSwipeDrag
  console.log(`\nExpected gap (card's own margin to screen edge): ~${expectedGap}px`);
  if (Math.abs(gapInfo.gap - expectedGap) > 2) {
    throw new Error(`Gap mismatch dragging up: got ${gapInfo.gap}px, expected ~${expectedGap}px (outgoing height ${gapInfo.outHeight}, incoming height ${gapInfo.incHeight} -- very different, which is exactly the case that used to break this)`);
  }
  console.log('Gap matches expectation dragging from a SHORT card to a TALL one.');

  console.log('\n=== Now the reverse: open Andrew (tall couple card), drag up to reveal Max (short child) ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  await page.click('.person-card:has-text("Andrew An Tang")');
  await page.waitForTimeout(300);
  const zoneBox2 = await page.locator('#viewSwipeZone').boundingBox();
  const cx2 = zoneBox2.x + zoneBox2.width / 2;
  const cy2 = zoneBox2.y + zoneBox2.height / 2;
  await page.mouse.move(cx2, cy2);
  await page.mouse.down();
  await page.mouse.move(cx2, cy2 - 40, { steps: 4 });
  await page.waitForTimeout(50);

  const gapInfo2 = await page.evaluate(() => {
    const layer = document.querySelector('.swipe-drag-layer');
    const out = layer.querySelector('.swipe-card-outgoing');
    const inc = layer.querySelector('.swipe-card-incoming');
    const outRect = out.getBoundingClientRect();
    const incRect = inc.getBoundingClientRect();
    return {
      outBottom: outRect.bottom,
      incTop: incRect.top,
      gap: incRect.top - outRect.bottom,
      outHeight: outRect.height,
      incHeight: incRect.height,
    };
  });
  console.log(JSON.stringify(gapInfo2, null, 2));
  await page.mouse.up();
  await page.waitForTimeout(400);

  if (Math.abs(gapInfo2.gap - expectedGap) > 2) {
    throw new Error(`Gap mismatch dragging down: got ${gapInfo2.gap}px, expected ~${expectedGap}px (outgoing height ${gapInfo2.outHeight}, incoming height ${gapInfo2.incHeight})`);
  }
  console.log('Gap matches expectation dragging from a TALL card to a SHORT one.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
