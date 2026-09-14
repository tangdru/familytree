import { chromium } from 'playwright-core';

const dad = 'dad', mom = 'mom', me = 'me', sibOld = 'sibOld', sibYoung = 'sibYoung', kid = 'kid';
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

  const currentName = () => page.evaluate(() => document.getElementById('viewName').textContent);
  const openMiddle = async () => {
    await page.click('.person-card:has-text("Middle Doe")');
    await page.waitForTimeout(200);
  };

  console.log('=== Clicking each dot indicator navigates the direction it hints at ===');
  await openMiddle();
  await page.click('#viewDotsSideRight');
  await page.waitForTimeout(600);
  if (await currentName() !== 'Younger Sib Doe') throw new Error('Expected right dot to navigate to the younger sibling');
  await page.click('#viewCloseBtn');

  await openMiddle();
  await page.click('#viewDotsSideLeft');
  await page.waitForTimeout(600);
  if (await currentName() !== 'Older Sib Doe') throw new Error('Expected left dot to navigate to the older sibling');
  await page.click('#viewCloseBtn');

  await openMiddle();
  await page.click('#viewDotsChildren');
  await page.waitForTimeout(600);
  if (await currentName() !== 'Kid Doe') throw new Error('Expected bottom dot to navigate to the child');
  await page.click('#viewCloseBtn');

  await openMiddle();
  await page.click('#viewDotsParents');
  await page.waitForTimeout(600);
  if (await currentName() !== 'Papa Doe') throw new Error('Expected top dot to navigate to a parent');
  console.log('Confirmed: all four dot indicators navigate to the correct neighbor.');

  console.log('\n=== The transition actually animates (not an instant cut) ===');
  await page.click('#viewCloseBtn');
  await openMiddle();
  await page.click('#viewDotsSideRight');
  const samples = [];
  for (let i = 0; i < 6; i++) {
    samples.push(await page.evaluate(() => {
      const el = document.querySelector('.swipe-card-outgoing');
      return el ? getComputedStyle(el).transform : null;
    }));
    await page.waitForTimeout(40);
  }
  const distinct = new Set(samples.filter(Boolean));
  if (distinct.size < 3) throw new Error(`Expected several distinct in-flight transform values, got ${JSON.stringify(samples)}`);
  await page.waitForTimeout(600);
  console.log('Confirmed: the outgoing card animates through multiple positions instead of jumping straight to the end.');

  console.log('\n=== A dead-end direction (no neighbor) does not navigate or get stuck ===');
  await page.click('#viewCloseBtn');
  await page.click('.person-card:has-text("Younger Sib Doe")');
  await page.waitForTimeout(200);
  const before = await currentName();
  await page.evaluate(() => document.getElementById('viewDotsChildren').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(600);
  const after = await currentName();
  const layerGone = await page.evaluate(() => !document.querySelector('.swipe-drag-layer'));
  const cardVisible = await page.evaluate(() => getComputedStyle(document.getElementById('personViewCard')).visibility !== 'hidden');
  if (before !== after) throw new Error('Expected a dead-end dot click not to navigate anywhere');
  if (!layerGone || !cardVisible) throw new Error('Expected the drag overlay to clean up after a dead-end click');
  console.log('Confirmed: clicking an empty direction is a safe no-op.');

  console.log('\n=== Hit area extends well past the visible dot ===');
  await page.click('#viewCloseBtn');
  await openMiddle();
  const box = await page.locator('#viewDotsSideRight').boundingBox();
  if (box.width < 20 || box.height < 20) throw new Error(`Expected an enlarged (~26px) hit area, got ${JSON.stringify(box)}`);
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  if (await currentName() !== 'Younger Sib Doe') throw new Error('Expected a click near the edge of the enlarged hit area to still navigate');
  console.log('Confirmed: the hit area is enlarged and clickable out to its edge.');

  console.log('\n=== Pointer cursor only over a dot indicator that actually has a dot ===');
  await page.click('#viewCloseBtn');
  await page.click('.person-card:has-text("Younger Sib Doe")');
  await page.waitForTimeout(200);
  const cursors = await page.evaluate(() => ({
    parents: getComputedStyle(document.getElementById('viewDotsParents')).cursor, // has parents
    children: getComputedStyle(document.getElementById('viewDotsChildren')).cursor, // Younger Sib Doe has none
  }));
  if (cursors.parents !== 'pointer') throw new Error(`Expected pointer cursor over a non-empty dots strip, got ${JSON.stringify(cursors)}`);
  if (cursors.children === 'pointer') throw new Error(`Expected a non-pointer cursor over an empty (reserved) dots strip, got ${JSON.stringify(cursors)}`);
  console.log('Confirmed: pointer cursor only appears where a click actually does something.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
