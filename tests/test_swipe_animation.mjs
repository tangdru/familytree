import { chromium } from 'playwright-core';

const dad = 'dad';
const mom = 'mom';
const me = 'me';
const sibOld = 'sibOld'; // older, drag right should reveal
const sibYoung = 'sibYoung'; // younger, drag left should reveal
const kid = 'kid';
const people = {
  [dad]: { id: dad, name: 'Papa Doe', birthDate: '1920-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [mom] },
  [mom]: { id: mom, name: 'Mama Doe', birthDate: '1922-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [dad] },
  [sibOld]: { id: sibOld, name: 'Older Sib Doe', birthDate: '1945-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [me]: { id: me, name: 'Middle Doe', birthDate: '1948-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [sibYoung]: { id: sibYoung, name: 'Younger Sib Doe', birthDate: '1951-01-01', deathDate: '', photo: '', notes: '', parents: [dad, mom], spouses: [] },
  [kid]: { id: kid, name: 'Kid Doe', birthDate: '1975-01-01', deathDate: '', photo: '', notes: '', parents: [me], spouses: [] },
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
  await page.waitForTimeout(200);

  console.log('=== Dot indicators reflect availability: left(older sib)=visible, right(younger sib)=visible, up(child)=visible ===');
  let hints = await page.evaluate(() => ({
    left: !document.getElementById('viewDotsSideLeft').hidden, // older siblings, to the left in the tree
    right: !document.getElementById('viewDotsSideRight').hidden, // younger siblings, to the right in the tree
    up: !document.getElementById('viewDotsChildren').hidden,
  }));
  console.log(JSON.stringify(hints));
  if (!hints.left || !hints.right || !hints.up) throw new Error('Expected all three dot indicators visible for Middle Doe: ' + JSON.stringify(hints));

  const zoneBox = await page.locator('#viewSwipeZone').boundingBox();
  const cx = zoneBox.x + zoneBox.width / 2;
  const cy = zoneBox.y + zoneBox.height / 2;

  console.log('\n=== Mid-drag left (toward younger sibling): drag layer + incoming peek should be visible ===');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 30, cy, { steps: 5 });
  await page.waitForTimeout(30);
  let midDrag = await page.evaluate(() => {
    const layer = document.querySelector('.swipe-drag-layer');
    return {
      layerExists: !!layer,
      realHidden: getComputedStyle(document.getElementById('viewSwipeZone')).visibility,
      incomingText: layer ? (layer.querySelector('.swipe-card-incoming .view-name')?.textContent || '') : null,
    };
  });
  console.log(JSON.stringify(midDrag));
  if (!midDrag.layerExists) throw new Error('Expected a drag layer to be mounted mid-drag');
  if (midDrag.realHidden !== 'hidden') throw new Error('Expected the real swipe zone to be hidden mid-drag');
  if (midDrag.incomingText !== 'Younger Sib Doe') throw new Error('Expected the incoming peek to show Younger Sib Doe, got: ' + midDrag.incomingText);

  await page.mouse.move(cx - 90, cy, { steps: 5 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(400);

  console.log('\n=== After a committed left swipe past threshold: view should now show Younger Sib Doe ===');
  const afterLeft = await page.evaluate(() => ({
    name: document.getElementById('viewName').textContent,
    layerGone: !document.querySelector('.swipe-drag-layer'),
    realVisible: getComputedStyle(document.getElementById('viewSwipeZone')).visibility,
  }));
  console.log(JSON.stringify(afterLeft));
  if (afterLeft.name !== 'Younger Sib Doe') throw new Error('Expected committed left swipe to land on Younger Sib Doe, got: ' + afterLeft.name);
  if (!afterLeft.layerGone) throw new Error('Expected the drag layer to be cleaned up after commit');
  if (afterLeft.realVisible !== 'visible') throw new Error('Expected the real swipe zone visible again after commit');

  console.log('\n=== Younger Sib Doe has no younger sibling: dead-end drag left should spring back, no navigation ===');
  hints = await page.evaluate(() => ({
    right: !document.getElementById('viewDotsSideRight').hidden,
  }));
  console.log('right dot indicator for Younger Sib Doe (expect false, no younger sibling):', hints.right);
  if (hints.right) throw new Error('Expected no right dot indicator for the youngest sibling');

  const zoneBox2 = await page.locator('#viewSwipeZone').boundingBox();
  const cx2 = zoneBox2.x + zoneBox2.width / 2;
  const cy2 = zoneBox2.y + zoneBox2.height / 2;
  await page.mouse.move(cx2, cy2);
  await page.mouse.down();
  await page.mouse.move(cx2 - 90, cy2, { steps: 6 });
  await page.waitForTimeout(30);
  const midDeadEnd = await page.evaluate(() => {
    const layer = document.querySelector('.swipe-drag-layer');
    return { hasIncoming: layer ? !!layer.querySelectorAll('.swipe-card-slot').length > 1 : null, slotCount: layer ? layer.children.length : 0 };
  });
  console.log('dead-end mid-drag slot count (expect 1, outgoing only):', JSON.stringify(midDeadEnd));
  if (midDeadEnd.slotCount !== 1) throw new Error('Expected only the outgoing card in a dead-end drag, got ' + midDeadEnd.slotCount + ' slots');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDeadEnd = await page.evaluate(() => document.getElementById('viewName').textContent);
  console.log('name after dead-end release (expect unchanged):', afterDeadEnd);
  if (afterDeadEnd !== 'Younger Sib Doe') throw new Error('Expected dead-end swipe to leave the view unchanged, got: ' + afterDeadEnd);

  console.log('\n=== Small drag below threshold springs back without navigating ===');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(150);
  await page.click('.person-card:has-text("Middle Doe")');
  await page.waitForTimeout(200);
  const zoneBox3 = await page.locator('#viewSwipeZone').boundingBox();
  const cx3 = zoneBox3.x + zoneBox3.width / 2;
  const cy3 = zoneBox3.y + zoneBox3.height / 2;
  await page.mouse.move(cx3, cy3);
  await page.mouse.down();
  await page.mouse.move(cx3 - 25, cy3, { steps: 4 }); // past deadzone, well under threshold
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterSmallDrag = await page.evaluate(() => ({
    name: document.getElementById('viewName').textContent,
    layerGone: !document.querySelector('.swipe-drag-layer'),
  }));
  console.log(JSON.stringify(afterSmallDrag));
  if (afterSmallDrag.name !== 'Middle Doe') throw new Error('Expected a below-threshold drag to leave the view on Middle Doe, got: ' + afterSmallDrag.name);
  if (!afterSmallDrag.layerGone) throw new Error('Expected the drag layer cleaned up after spring-back');

  console.log('\n=== Vertical swipe up commits to the child ===');
  const zoneBox4 = await page.locator('#viewSwipeZone').boundingBox();
  const cx4 = zoneBox4.x + zoneBox4.width / 2;
  const cy4 = zoneBox4.y + zoneBox4.height / 2;
  await page.mouse.move(cx4, cy4);
  await page.mouse.down();
  await page.mouse.move(cx4, cy4 - 90, { steps: 6 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterUp = await page.evaluate(() => document.getElementById('viewName').textContent);
  console.log('name after swipe up (expect Kid Doe):', afterUp);
  if (afterUp !== 'Kid Doe') throw new Error('Expected swipe up to land on Kid Doe, got: ' + afterUp);

  console.log('\n=== Vertical swipe down commits back to the parent (Middle Doe) ===');
  const zoneBox5 = await page.locator('#viewSwipeZone').boundingBox();
  const cx5 = zoneBox5.x + zoneBox5.width / 2;
  const cy5 = zoneBox5.y + zoneBox5.height / 2;
  await page.mouse.move(cx5, cy5);
  await page.mouse.down();
  await page.mouse.move(cx5, cy5 + 90, { steps: 6 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDown = await page.evaluate(() => document.getElementById('viewName').textContent);
  console.log('name after swipe down (expect Middle Doe):', afterDown);
  if (afterDown !== 'Middle Doe') throw new Error('Expected swipe down to return to Middle Doe, got: ' + afterDown);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
