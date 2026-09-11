import { chromium } from 'playwright-core';

function person(id, extra) {
  return { id, name: id, birthDate: '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: [], ...extra };
}
const people = {};
const add = (p) => { people[p.id] = p; };

// Thomas: 2 parents, 3 siblings (2 older, 1 younger by birthDate), 1 child.
add(person('walter', { name: 'Walter Hayes', birthDate: '1943-01-01' }));
add(person('eleanor', { name: 'Eleanor Hayes', birthDate: '1946-01-01' }));
add(person('older1', { name: 'Older Sib One', birthDate: '1968-01-01', parents: ['walter', 'eleanor'] }));
add(person('older2', { name: 'Older Sib Two', birthDate: '1970-01-01', parents: ['walter', 'eleanor'] }));
add(person('thomas', { name: 'Thomas Hayes', birthDate: '1975-01-01', zodiac: 'Dog', parents: ['walter', 'eleanor'], birthLocation: 'Boston, USA', locations: ['Chicago, USA'] }));
add(person('younger1', { name: 'Younger Sib One', birthDate: '1980-01-01', parents: ['walter', 'eleanor'] }));
add(person('kid1', { name: 'Kid One', birthDate: '2000-01-01', parents: ['thomas'] }));
// Solo: no recorded relations at all.
add(person('solo', { name: 'Solo Person' }));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const dotState = () => page.evaluate(() => ({
    parents: document.getElementById('viewDotsParents').children.length,
    parentsHidden: document.getElementById('viewDotsParents').hidden,
    children: document.getElementById('viewDotsChildren').children.length,
    childrenHidden: document.getElementById('viewDotsChildren').hidden,
    left: document.getElementById('viewDotsSideLeft').children.length,
    leftHidden: document.getElementById('viewDotsSideLeft').hidden,
    right: document.getElementById('viewDotsSideRight').children.length,
    rightHidden: document.getElementById('viewDotsSideRight').hidden,
  }));

  console.log('=== Thomas: 2 parents, 1 child, 2 older siblings (left), 1 younger sibling (right) ===');
  await page.click('.person-card[data-id="thomas"]');
  await page.waitForTimeout(300);
  const d = await dotState();
  console.log(JSON.stringify(d));
  if (d.parents !== 2 || d.parentsHidden) throw new Error(`Expected 2 visible parent dots, got ${JSON.stringify(d)}`);
  if (d.children !== 1 || d.childrenHidden) throw new Error(`Expected 1 visible child dot, got ${JSON.stringify(d)}`);
  // Left/right mirrors the tree's own left-to-right layout (oldest to
  // youngest, see computeOrder) -- left = older, right = younger.
  if (d.left !== 2 || d.leftHidden) throw new Error(`Expected 2 older-sibling dots on the left, got ${JSON.stringify(d)}`);
  if (d.right !== 1 || d.rightHidden) throw new Error(`Expected 1 younger-sibling dot on the right, got ${JSON.stringify(d)}`);
  console.log('Confirmed: dot counts match parents/children/siblings, siblings split left(older)/right(younger) by birth order.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Walter: no parents, no children shown here (he is a parent, not a child, in this dataset) except... has 4 children (older1, older2, thomas, younger1), no siblings ===');
  await page.click('.person-card[data-id="walter"]');
  await page.waitForTimeout(300);
  const dw = await dotState();
  console.log(JSON.stringify(dw));
  if (dw.parents !== 0 || !dw.parentsHidden) throw new Error(`Expected no parent dots for Walter, got ${JSON.stringify(dw)}`);
  if (dw.children !== 4 || dw.childrenHidden) throw new Error(`Expected 4 child dots for Walter, got ${JSON.stringify(dw)}`);
  if (dw.left !== 0 || !dw.leftHidden || dw.right !== 0 || !dw.rightHidden) throw new Error(`Expected no sibling dots for Walter (no recorded parents), got ${JSON.stringify(dw)}`);
  console.log('Confirmed: a person with no recorded parents shows no sibling dots at all.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Solo: no relations at all -- every dot strip hidden, relations divider hidden ===');
  await page.click('.person-card[data-id="solo"]');
  await page.waitForTimeout(300);
  const ds = await dotState();
  const relDividerHidden = await page.evaluate(() => document.getElementById('viewRelationsDivider').hidden);
  console.log(JSON.stringify({ ...ds, relDividerHidden }));
  if (!ds.parentsHidden || !ds.childrenHidden || !ds.leftHidden || !ds.rightHidden) {
    throw new Error(`Expected every dot strip hidden for a person with no relations, got ${JSON.stringify(ds)}`);
  }
  if (!relDividerHidden) throw new Error('Expected the relations divider to stay hidden with no relation sections to introduce');
  console.log('Confirmed: no relations means no dots and no orphan divider.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
