import { chromium } from 'playwright-core';

// Regression check for the exact bug class from PR #74/#75: a style rule
// scoped to an ancestor id (or otherwise not surviving stripIds) applies
// at rest but silently reverts on the swipe-drag clones. Verifies the
// card's top whitespace (no header, padding-top: 40px) and the photo's
// vertical position are IDENTICAL between the real card, the outgoing
// clone, and the incoming clone while a drag is actually in progress --
// not just before/after.

const dad = 'dad';
const mom = 'mom';
const me = 'me';
const sibYoung = 'sibYoung';
const people = {
  [dad]: { id: dad, name: 'Papa Doe', birthDate: '1920-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [mom] },
  [mom]: { id: mom, name: 'Mama Doe', birthDate: '1922-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [dad] },
  [me]: { id: me, name: 'Middle Doe', birthDate: '1948-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [sibYoung]: { id: sibYoung, name: 'Younger Sib Doe', birthDate: '1951-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
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
  await page.click('.person-card:has-text("Middle Doe")');
  await page.waitForTimeout(250);

  const restInfo = await page.evaluate(() => {
    const card = document.getElementById('personViewCard');
    const zone = document.getElementById('viewSwipeZone');
    const cardRect = card.getBoundingClientRect();
    const zoneRect = zone.getBoundingClientRect();
    return {
      topWhitespace: zoneRect.top - cardRect.top,
      headerExists: !!card.querySelector('.modal-header, .view-modal-header'),
    };
  });
  console.log('=== Rest state ===');
  console.log(JSON.stringify(restInfo));
  if (restInfo.headerExists) throw new Error('Expected no header element on the real card');
  if (Math.abs(restInfo.topWhitespace - 40) > 1) throw new Error(`Expected ~40px top whitespace at rest, got ${restInfo.topWhitespace}`);

  console.log('\n=== Mid-drag (left, toward Younger Sib Doe) ===');
  const zoneBox = await page.locator('#viewSwipeZone').boundingBox();
  const cx = zoneBox.x + zoneBox.width / 2;
  const cy = zoneBox.y + zoneBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 150, cy, { steps: 6 });
  await page.waitForTimeout(50);

  const midDragInfo = await page.evaluate(() => {
    const layer = document.querySelector('.swipe-drag-layer');
    const out = layer.querySelector('.swipe-card-outgoing');
    const inc = layer.querySelector('.swipe-card-incoming');
    function topWhitespace(cardEl) {
      const zone = cardEl.querySelector('#viewSwipeZone') || cardEl.querySelector('.view-swipe-zone');
      const cardRect = cardEl.getBoundingClientRect();
      const zoneRect = zone.getBoundingClientRect();
      return zoneRect.top - cardRect.top;
    }
    return {
      outTopWhitespace: topWhitespace(out),
      incTopWhitespace: topWhitespace(inc),
      outHasHeader: !!out.querySelector('.modal-header, .view-modal-header'),
      incHasHeader: !!inc.querySelector('.modal-header, .view-modal-header'),
      outHeight: out.getBoundingClientRect().height,
      incHeight: inc.getBoundingClientRect().height,
    };
  });
  console.log(JSON.stringify(midDragInfo, null, 2));

  if (midDragInfo.outHasHeader || midDragInfo.incHasHeader) {
    throw new Error('Expected neither the outgoing nor incoming clone to have a header element mid-drag');
  }
  if (Math.abs(midDragInfo.outTopWhitespace - 40) > 1) {
    throw new Error(`Outgoing clone's top whitespace reverted mid-drag: got ${midDragInfo.outTopWhitespace}, expected ~40`);
  }
  if (Math.abs(midDragInfo.incTopWhitespace - 40) > 1) {
    throw new Error(`Incoming clone's top whitespace reverted mid-drag: got ${midDragInfo.incTopWhitespace}, expected ~40 (this is exactly the #74/#75 bug class)`);
  }
  if (Math.abs(midDragInfo.outHeight - midDragInfo.incHeight) > 1) {
    throw new Error(`Outgoing/incoming heights diverged mid-drag: ${midDragInfo.outHeight} vs ${midDragInfo.incHeight}`);
  }

  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterInfo = await page.evaluate(() => {
    const card = document.getElementById('personViewCard');
    const zone = document.getElementById('viewSwipeZone');
    const cardRect = card.getBoundingClientRect();
    const zoneRect = zone.getBoundingClientRect();
    return {
      name: document.getElementById('viewName').textContent,
      topWhitespace: zoneRect.top - cardRect.top,
    };
  });
  console.log('\n=== After committing the swipe ===');
  console.log(JSON.stringify(afterInfo));
  if (afterInfo.name !== 'Younger Sib Doe') throw new Error('Expected the swipe to have committed to Younger Sib Doe');
  if (Math.abs(afterInfo.topWhitespace - 40) > 1) throw new Error(`Expected ~40px top whitespace after landing, got ${afterInfo.topWhitespace}`);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED -- header stays gone and top whitespace stays consistent (real card, outgoing clone, incoming clone) throughout the whole gesture.');
} finally {
  await browser.close();
}
